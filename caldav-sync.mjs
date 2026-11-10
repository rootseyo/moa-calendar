// Two-Way Sync Engine for CalDAV (Apple iCloud <-> DWM Moa Calendar)
import { randomUUID } from 'node:crypto';
import { query as defaultQuery, transaction as defaultTransaction } from './db.mjs';
import { decryptSecret } from './google-tokens.mjs';
import {
  discoverICloudCalendars,
  hexToClosestDwmColor,
  fetchCalendarEvents,
  putCalendarEvent,
  deleteCalendarEvent,
} from './caldav.mjs';
import { formatIcsEvent } from './ical.mjs';
import { EVENT_COLORS } from './public/event-utils.js';

export function createSyncEngine({
  dbQuery = defaultQuery,
  dbTransaction = defaultTransaction,
  broadcastFn = () => {},
  allowedHosts = [],
  hasPendingMove = async () => false,
} = {}) {
  const activeSyncs = new Set();

  /**
   * Syncs a single external calendar (iCloud -> DWM).
   */
  async function syncExternalCalendar(externalCalendarId, options = {}) {
    if (activeSyncs.has(externalCalendarId)) {
      return { skipped: true, reason: 'Sync already in progress' };
    }
    activeSyncs.add(externalCalendarId);
    let connectionId = null;

    try {
      // 1. Fetch external calendar and its connection
      const ecRows = (await dbQuery(`
        SELECT ec.*, cc.user_id, cc.account_email, cc.encrypted_credentials, cc.connection_status
        FROM external_calendars ec
        JOIN calendar_connections cc ON cc.id = ec.connection_id
        WHERE ec.id = $1
      `, [externalCalendarId])).rows;

      if (!ecRows.length) {
        throw new Error('연동된 캘린더를 찾을 수 없습니다.');
      }

      const ec = ecRows[0];
      if(await hasPendingMove(ec.calendar_id))return {skipped:true,reason:'Calendar move sync pending'};
      connectionId = ec.connection_id;
      const eventColor = EVENT_COLORS.includes(ec.color) ? ec.color : hexToClosestDwmColor(ec.color);
      if (ec.connection_status !== 'connected' || !ec.is_enabled) {
        return { skipped: true, reason: 'Calendar is disabled or connection is invalid' };
      }

      if (!ec.calendar_id) {
        throw new Error('DWM 내부 캘린더가 매핑되지 않았습니다.');
      }

      // 2. Decrypt Apple app-specific password
      const password = decryptSecret(ec.encrypted_credentials, `icloud:${ec.user_id}`);
      if (!password) {
        await dbQuery("UPDATE calendar_connections SET connection_status='invalid_credentials', last_sync_error='비밀번호 복호화 실패' WHERE id=$1", [ec.connection_id]);
        throw new Error('인증 정보를 복호화할 수 없습니다.');
      }

      // 3. Fetch remote events via CalDAV REPORT
      let remoteItems = [];
      try {
        remoteItems = await fetchCalendarEvents(ec.calendar_url, ec.account_email, password, {
          allowedHosts,
          timeMin: options.timeMin,
          timeMax: options.timeMax,
        });
      } catch (err) {
        const errorMsg = err.message || 'CalDAV 일정 조회 실패';
        if (err.status === 401) {
          await dbQuery("UPDATE calendar_connections SET connection_status='invalid_credentials', last_sync_error=$1, updated_at=now() WHERE id=$2", [errorMsg, ec.connection_id]);
        } else {
          await dbQuery("UPDATE calendar_connections SET last_sync_error=$1, updated_at=now() WHERE id=$2", [errorMsg, ec.connection_id]);
        }
        throw err;
      }

      // 4. Load existing mappings for this external calendar
      const mappingRows = (await dbQuery(`
        SELECT * FROM external_event_mappings WHERE external_calendar_id = $1
      `, [externalCalendarId])).rows;

      const mappingByUid = new Map(mappingRows.map(m => [m.external_event_uid, m]));
      const seenRemoteUids = new Set();
      let importedCount = 0;
      let updatedCount = 0;
      let deletedCount = 0;

      await dbTransaction(async client => {
        for (const item of remoteItems) {
          for (const ev of item.events) {
            if (!ev.uid) continue;
            seenRemoteUids.add(ev.uid);

            const existingMapping = mappingByUid.get(ev.uid);

            // Handle remote cancellation
            if (ev.status === 'CANCELLED') {
              if (existingMapping) {
                await client.query('DELETE FROM events WHERE id = $1', [existingMapping.local_event_id]);
                await client.query('DELETE FROM external_event_mappings WHERE id = $1', [existingMapping.id]);
                deletedCount++;
              }
              continue;
            }

            if (existingMapping) {
              // Existing mapped event
              if (existingMapping.etag !== item.etag) {
                // Remote updated!
                await client.query(`
                  UPDATE events
                  SET title = $1, start = $2, "end" = $3, all_day = $4, notes = $5, version = version + 1
                  WHERE id = $6 AND calendar_id = $7
                `, [
                  ev.title,
                  ev.start,
                  ev.end,
                  ev.allDay,
                  ev.notes,
                  existingMapping.local_event_id,
                  ec.calendar_id,
                ]);

                await client.query(`
                  UPDATE external_event_mappings
                  SET etag = $1, external_object_url = $2, last_synced_at = now()
                  WHERE id = $3
                `, [item.etag, item.eventUrl, existingMapping.id]);

                updatedCount++;
              }
            } else {
              // New remote event -> insert into DWM events and mappings
              const localEventId = randomUUID();
              await client.query(`
                INSERT INTO events(id, calendar_id, title, start, "end", color, notes, category, all_day, version)
                VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
              `, [
                localEventId,
                ec.calendar_id,
                ev.title,
                ev.start,
                ev.end,
                eventColor,
                ev.notes,
                'iCloud',
                ev.allDay,
              ]);

              await client.query(`
                INSERT INTO external_event_mappings(id, external_calendar_id, local_event_id, external_event_uid, external_object_url, etag, last_synced_at)
                VALUES($1, $2, $3, $4, $5, $6, now())
              `, [
                randomUUID(),
                externalCalendarId,
                localEventId,
                ev.uid,
                item.eventUrl,
                item.etag,
              ]);

              importedCount++;
            }
          }
        }

        // Delete events that were removed from remote (if this wasn't a partial time query)
        if (!options.timeMin && !options.timeMax) {
          for (const [uid, mapping] of mappingByUid) {
            if (!seenRemoteUids.has(uid)) {
              await client.query('DELETE FROM events WHERE id = $1', [mapping.local_event_id]);
              await client.query('DELETE FROM external_event_mappings WHERE id = $1', [mapping.id]);
              deletedCount++;
            }
          }
        }

        // Update sync timestamps
        await client.query(`
          UPDATE external_calendars
          SET last_sync_at = now(), updated_at = now()
          WHERE id = $1
        `, [externalCalendarId]);

        await client.query(`
          UPDATE calendar_connections
          SET last_sync_at = now(), last_sync_error = NULL, connection_status = 'connected', updated_at = now()
          WHERE id = $1
        `, [ec.connection_id]);
      });

      // 5. If two-way sync is active, check if there are local DWM events that need to be pushed to iCloud
      if (!options.pullOnly && ec.sync_direction === 'two_way' && !ec.is_read_only) {
        await pushPendingLocalEvents(ec, password);
      }

      broadcastFn(ec.calendar_id, 'change');

      return {
        ok: true,
        importedCount,
        updatedCount,
        deletedCount,
        totalRemote: remoteItems.length,
      };
    } catch(err) {
      const message=err.code==='23514'?'iCloud 일정의 데이터 형식을 처리하지 못했습니다.':err.message||'iCloud 동기화에 실패했습니다.';
      if(connectionId)await dbQuery('UPDATE calendar_connections SET last_sync_error=$1, updated_at=now() WHERE id=$2',[message,connectionId]).catch(()=>{});
      if(err.code==='23514')throw Object.assign(new Error(message),{status:502});
      throw err;
    } finally {
      activeSyncs.delete(externalCalendarId);
    }
  }

  /**
   * Pushes unmapped or pending local DWM events to iCloud.
   */
  async function pushPendingLocalEvents(ec, password) {
    const unmappedRows = (await dbQuery(`
      SELECT e.*
      FROM events e
      LEFT JOIN external_event_mappings m ON m.local_event_id = e.id
      WHERE e.calendar_id = $1 AND m.id IS NULL
    `, [ec.calendar_id])).rows;

    for (const localEvent of unmappedRows) {
      try {
        let domain = 'moa-calendar.local';
        try { if (process.env.APP_URL) domain = new URL(process.env.APP_URL).hostname || domain; } catch {}
        const uid = `moa-${localEvent.id}@${domain}`;
        const ics = formatIcsEvent({
          uid,
          title: localEvent.title,
          start: localEvent.start,
          end: localEvent.end,
          allDay: localEvent.all_day,
          notes: localEvent.notes,
        });

        const calUrlClean = ec.calendar_url.endsWith('/') ? ec.calendar_url : `${ec.calendar_url}/`;
        const eventUrl = `${calUrlClean}${encodeURIComponent(uid)}.ics`;

        const putRes = await putCalendarEvent(eventUrl, ics, ec.account_email, password, {
          allowedHosts,
          isNew: true,
        });

        await dbQuery(`
          INSERT INTO external_event_mappings(id, external_calendar_id, local_event_id, external_event_uid, external_object_url, etag, last_synced_at)
          VALUES($1, $2, $3, $4, $5, $6, now())
          ON CONFLICT(local_event_id) DO UPDATE SET etag = EXCLUDED.etag, last_synced_at = now()
        `, [
          randomUUID(),
          ec.id,
          localEvent.id,
          uid,
          eventUrl,
          putRes.etag,
        ]);
      } catch (err) {
        console.warn('Failed to push local event to iCloud:', localEvent.id, err.message);
      }
    }
  }

  /**
   * Syncs all enabled external calendars belonging to a connection.
   */
  async function syncCalendarConnection(connectionId) {
    const cals = (await dbQuery(`
      SELECT id FROM external_calendars WHERE connection_id = $1 AND is_enabled = true
    `, [connectionId])).rows;

    const results = [];
    for (const cal of cals) {
      try {
        const res = await syncExternalCalendar(cal.id);
        results.push({ calendarId: cal.id, ...res });
      } catch (err) {
        results.push({ calendarId: cal.id, ok: false, error: err.message });
      }
    }
    return results;
  }

  /**
   * Pushes a single local mutation to external CalDAV (called when DWM event is created/updated/deleted).
   */
  async function pushLocalEventToExternal(localEventId, action, options = {}) {
    const { calendarId, eventData } = options;

    // Check if this calendar is linked to a two-way external calendar
    const ecRows = (await dbQuery(`
      SELECT ec.*, cc.account_email, cc.encrypted_credentials, cc.user_id, cc.connection_status
      FROM external_calendars ec
      JOIN calendar_connections cc ON cc.id = ec.connection_id
      WHERE ec.calendar_id = $1 AND ec.is_enabled = true AND ec.sync_direction = 'two_way' AND ec.is_read_only = false
    `, [calendarId])).rows;

    if (!ecRows.length) return null;
    const ec = ecRows[0];
    if (ec.connection_status !== 'connected') return null;

    const password = decryptSecret(ec.encrypted_credentials, `icloud:${ec.user_id}`);
    if (!password) return null;

    const mapping = (await dbQuery(`
      SELECT * FROM external_event_mappings WHERE local_event_id = $1
    `, [localEventId])).rows[0];

    if (action === 'create' || (!mapping && action === 'update')) {
      const ev = eventData || (await dbQuery('SELECT * FROM events WHERE id = $1', [localEventId])).rows[0];
      if (!ev) return null;

      let domain = 'moa-calendar.local';
      try { if (process.env.APP_URL) domain = new URL(process.env.APP_URL).hostname || domain; } catch {}
      const uid = `moa-${localEventId}@${domain}`;
      const ics = formatIcsEvent({
        uid,
        title: ev.title,
        start: ev.start,
        end: ev.end,
        allDay: ev.all_day,
        notes: ev.notes,
      });

      const calUrlClean = ec.calendar_url.endsWith('/') ? ec.calendar_url : `${ec.calendar_url}/`;
      const eventUrl = `${calUrlClean}${encodeURIComponent(uid)}.ics`;

      const putRes = await putCalendarEvent(eventUrl, ics, ec.account_email, password, {
        allowedHosts,
        isNew: true,
      });

      await dbQuery(`
        INSERT INTO external_event_mappings(id, external_calendar_id, local_event_id, external_event_uid, external_object_url, etag, last_synced_at)
        VALUES($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT(local_event_id) DO UPDATE SET etag = EXCLUDED.etag, last_synced_at = now()
      `, [
        randomUUID(),
        ec.id,
        localEventId,
        uid,
        eventUrl,
        putRes.etag,
      ]);

      return { ok: true, action: 'created', eventUrl };
    }

    if (action === 'update' && mapping) {
      const ev = eventData || (await dbQuery('SELECT * FROM events WHERE id = $1', [localEventId])).rows[0];
      if (!ev) return null;

      const ics = formatIcsEvent({
        uid: mapping.external_event_uid,
        title: ev.title,
        start: ev.start,
        end: ev.end,
        allDay: ev.all_day,
        notes: ev.notes,
        sequence: (ev.version || 1),
      });

      const putRes = await putCalendarEvent(mapping.external_object_url, ics, ec.account_email, password, {
        allowedHosts,
        etag: mapping.etag,
      });

      await dbQuery(`
        UPDATE external_event_mappings
        SET etag = $1, last_synced_at = now()
        WHERE id = $2
      `, [putRes.etag, mapping.id]);

      return { ok: true, action: 'updated', eventUrl: mapping.external_object_url };
    }

    if (action === 'delete' && mapping) {
      await deleteCalendarEvent(mapping.external_object_url, ec.account_email, password, {
        allowedHosts,
        etag: mapping.etag,
      });

      await dbQuery('DELETE FROM external_event_mappings WHERE id = $1', [mapping.id]);
      return { ok: true, action: 'deleted' };
    }

    return null;
  }

  let backgroundTimer = null;

  function startBackgroundSync(intervalMs = 15 * 60 * 1000) {
    if (backgroundTimer) return;

    const runSyncCycle = async () => {
      try {
        const cals = (await dbQuery(`
          SELECT ec.id
          FROM external_calendars ec
          JOIN calendar_connections cc ON cc.id = ec.connection_id
          WHERE ec.is_enabled = true AND cc.connection_status = 'connected'
        `)).rows;

        for (const cal of cals) {
          try {
            await syncExternalCalendar(cal.id);
          } catch (err) {
            console.warn(`[BackgroundSync] Failed sync for external calendar ${cal.id}:`, err.message);
          }
        }
      } catch (err) {
        console.warn('[BackgroundSync] Cycle error:', err.message);
      }
    };

    backgroundTimer = setInterval(runSyncCycle, intervalMs);
    backgroundTimer.unref?.();
  }

  function stopBackgroundSync() {
    if (backgroundTimer) {
      clearInterval(backgroundTimer);
      backgroundTimer = null;
    }
  }

  async function withCalendarLocks(ids,work){
    const unique=[...new Set(ids)];
    if(unique.some(id=>activeSyncs.has(id)))return false;
    unique.forEach(id=>activeSyncs.add(id));
    try{return await work();}finally{unique.forEach(id=>activeSyncs.delete(id));}
  }
  return {
    withCalendarLocks,
    syncExternalCalendar,
    syncCalendarConnection,
    pushLocalEventToExternal,
    startBackgroundSync,
    stopBackgroundSync,
  };
}
