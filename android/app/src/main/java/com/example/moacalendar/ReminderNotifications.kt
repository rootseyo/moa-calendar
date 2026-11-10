package com.example.moacalendar

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.example.moacalendar.model.CalendarEvent
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import java.time.LocalDateTime
import java.time.ZoneId

object ReminderNotifications {
    private const val CHANNEL_ID = "event_reminders"

    fun schedule(context: Context, events: List<CalendarEvent>) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val prefs = context.getSharedPreferences("moa_reminder_prefs", Context.MODE_PRIVATE)
        val activeIds = events.filter { it.reminder_enabled }.map { it.id }.toSet()
        val previousIds = prefs.getStringSet("scheduled_ids", emptySet()).orEmpty()
        (previousIds - activeIds).forEach { id ->
            val oldIntent = Intent(context, EventReminderReceiver::class.java).apply { action = "com.example.moacalendar.EVENT_REMINDER.$id" }
            PendingIntent.getBroadcast(context, id.hashCode(), oldIntent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let(manager::cancel)
        }
        prefs.edit().putStringSet("scheduled_ids", activeIds).apply()
        events.forEach { event ->
            val intent = Intent(context, EventReminderReceiver::class.java).apply {
                action = "com.example.moacalendar.EVENT_REMINDER.${event.id}"
                putExtra("event_id", event.id)
                putExtra("title", event.title)
            }
            val pending = PendingIntent.getBroadcast(context, event.id.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            manager.cancel(pending)
            if (!event.reminder_enabled) return@forEach
            val trigger = runCatching {
                LocalDateTime.parse(event.start).minusMinutes(event.reminder_minutes.toLong())
                    .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            }.getOrNull() ?: return@forEach
            if (trigger > System.currentTimeMillis()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (manager.canScheduleExactAlarms()) {
                        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pending)
                    } else {
                        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pending)
                    }
                } else {
                    manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pending)
                }
            }
        }
    }

    fun show(context: Context, id: String, title: String) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "일정 알림",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "일정 시작 전 리마인더 알림을 표시합니다."
                enableVibration(true)
                setShowBadge(true)
            }
            manager.createNotificationChannel(channel)
        }
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText("일정이 곧 시작돼요.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(id.hashCode(), notification) }
    }
}

class EventReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        ReminderNotifications.show(context, intent.getStringExtra("event_id") ?: "event",
            intent.getStringExtra("title") ?: "일정 알림")
    }
}

class ReminderBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val cached = context.getSharedPreferences("moa_repo_prefs", Context.MODE_PRIVATE)
            .getString("cached_events", null) ?: return
        val events = runCatching { Json { ignoreUnknownKeys = true }.decodeFromString<List<CalendarEvent>>(cached) }
            .getOrNull() ?: return
        ReminderNotifications.schedule(context, events)
    }
}
