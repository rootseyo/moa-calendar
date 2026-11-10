package com.example.moacalendar

import com.example.moacalendar.model.CalendarEvent
import com.example.moacalendar.model.CalendarItem
import com.example.moacalendar.model.EventColors
import com.example.moacalendar.model.KoreaHolidays
import com.example.moacalendar.widget.MoaMonthWidgetProvider
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class MoaCalendarModelTest {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    @Test
    fun testEventColorsPalette() {
        assertEquals(12, EventColors.PALETTE.size)
        assertEquals(0xFF368A4C, EventColors.getColor("sage"))
        assertEquals(0xFF2B7FFF, EventColors.getColor("blue"))
        assertEquals(0xFFF97316, EventColors.getColor("peach"))
        assertEquals(0xFF14B8A6, EventColors.getColor("teal"))
    }

    @Test
    fun testKoreaHolidays() {
        assertEquals("신정", KoreaHolidays.getHoliday("2026-01-01"))
        assertEquals("삼일절", KoreaHolidays.getHoliday("2026-03-01"))
        assertEquals("어린이날", KoreaHolidays.getHoliday("2026-05-05"))
        assertEquals("광복절", KoreaHolidays.getHoliday("2026-08-15"))
        assertEquals(null, KoreaHolidays.getHoliday("2026-08-14"))
    }

    @Test
    fun testCalendarEventSerialization() {
        val event = CalendarEvent(
            id = "test-1",
            calendar_id = "cal-1",
            title = "팀 회의",
            start = "2026-10-14T10:00",
            end = "2026-10-14T11:00",
            color = "sage",
            notes = "회의 내용",
            category = "업무",
            all_day = false,
            is_todo = true,
            completed = false
        )

        val encoded = json.encodeToString(event)
        assertTrue(encoded.contains("팀 회의"))
        assertTrue(encoded.contains("2026-10-14T10:00"))

        val decoded = json.decodeFromString<CalendarEvent>(encoded)
        assertEquals(event.id, decoded.id)
        assertEquals(event.title, decoded.title)
        assertEquals(event.is_todo, decoded.is_todo)
    }

    @Test
    fun testCalendarItemModel() {
        val calendar = CalendarItem(
            id = "c1",
            name = "모아 캘린더",
            color = "sage",
            role = "owner"
        )
        assertNotNull(calendar.id)
        assertEquals("모아 캘린더", calendar.name)
        assertEquals("owner", calendar.role)
    }

    @Test
    fun testUrlSanitizationNullAndBlank() {
        assertEquals(MainActivity.DEFAULT_URL, MainActivity.sanitizeUrl(null as String?))
        assertEquals(MainActivity.DEFAULT_URL, MainActivity.sanitizeUrl(""))
        assertEquals(MainActivity.DEFAULT_URL, MainActivity.sanitizeUrl("   "))
    }

    @Test
    fun testUrlSecurityTrusted() {
        assertTrue(MainActivity.isTrustedUrl("https://dwm.brightnetworks.kr"))
        assertTrue(MainActivity.isTrustedUrl("https://dwm.brightnetworks.kr/"))
        assertTrue(MainActivity.isTrustedUrl("https://dwm.brightnetworks.kr/calendar"))
        assertTrue(MainActivity.isTrustedUrl("https://dwm.brightnetworks.kr/events?month=10&year=2026#today"))

        val sanitized = MainActivity.sanitizeUrl("https://dwm.brightnetworks.kr/calendar?view=month#top")
        assertEquals("https://dwm.brightnetworks.kr/calendar?view=month#top", sanitized)
    }

    @Test
    fun testUrlSecurityRejectsMaliciousInputs() {
        // Cross-App Scripting vectors (javascript: scheme)
        org.junit.Assert.assertFalse(MainActivity.isTrustedUrl("javascript:alert(document.cookie)"))
        org.junit.Assert.assertFalse(MainActivity.isTrustedUrl("javascript://dwm.brightnetworks.kr/%0Aalert(1)"))
        assertEquals(MainActivity.DEFAULT_URL, MainActivity.sanitizeUrl("javascript:alert(1)"))

        // File and content schemes
        org.junit.Assert.assertFalse(MainActivity.isTrustedUrl("file:///data/data/kr.brightnetworks.dwm/databases/cookies"))
        org.junit.Assert.assertFalse(MainActivity.isTrustedUrl("content://media/external/images/media/1"))
        assertEquals(MainActivity.DEFAULT_URL, MainActivity.sanitizeUrl("file:///etc/hosts"))

        // Cleartext HTTP
        org.junit.Assert.assertFalse(MainActivity.isTrustedUrl("http://dwm.brightnetworks.kr/calendar"))
        assertEquals(MainActivity.DEFAULT_URL, MainActivity.sanitizeUrl("http://dwm.brightnetworks.kr"))

        // Untrusted hosts and subdomain spoofing
        org.junit.Assert.assertFalse(MainActivity.isTrustedUrl("https://evil.com"))
        org.junit.Assert.assertFalse(MainActivity.isTrustedUrl("https://evil.com/dwm.brightnetworks.kr"))
        org.junit.Assert.assertFalse(MainActivity.isTrustedUrl("https://dwm.brightnetworks.kr.evil.com"))
        org.junit.Assert.assertFalse(MainActivity.isTrustedUrl("https://notdwm.brightnetworks.kr"))
        assertEquals(MainActivity.DEFAULT_URL, MainActivity.sanitizeUrl("https://evil.com"))

        // User info spoofing (e.g. user:pass@host)
        org.junit.Assert.assertFalse(MainActivity.isTrustedUrl("https://user:pass@dwm.brightnetworks.kr"))
        org.junit.Assert.assertFalse(MainActivity.isTrustedUrl("https://dwm.brightnetworks.kr@evil.com"))
        assertEquals(MainActivity.DEFAULT_URL, MainActivity.sanitizeUrl("https://user@dwm.brightnetworks.kr"))

        // Non-standard ports
        org.junit.Assert.assertFalse(MainActivity.isTrustedUrl("https://dwm.brightnetworks.kr:8080/calendar"))
        assertEquals(MainActivity.DEFAULT_URL, MainActivity.sanitizeUrl("https://dwm.brightnetworks.kr:8080"))
    }

    @Test
    fun testWidgetDeepLinksAndActions() {
        val addUrl = "https://dwm.brightnetworks.kr/?action=new_event&date=2026-11-03"
        assertTrue(MainActivity.isTrustedUrl(addUrl))
        assertEquals(addUrl, MainActivity.sanitizeUrl(addUrl))

        val dateUrl = "https://dwm.brightnetworks.kr/?date=2026-11-15"
        assertTrue(MainActivity.isTrustedUrl(dateUrl))
        assertEquals(dateUrl, MainActivity.sanitizeUrl(dateUrl))

        val eventUrl = "https://dwm.brightnetworks.kr/?event_id=ev-456&date=2026-11-03"
        assertTrue(MainActivity.isTrustedUrl(eventUrl))
        assertEquals(eventUrl, MainActivity.sanitizeUrl(eventUrl))
    }

    @Test
    fun testCalendarEventWithDDayAndCancelled() {
        val jsonStr = """
            {
                "id": "ev-100",
                "calendar_id": "cal-1",
                "title": "디데이 시험",
                "start": "2026-11-20T09:00",
                "end": "2026-11-20T12:00",
                "color": "sage",
                "is_dday": true,
                "is_cancelled": false
            }
        """.trimIndent()

        val parsed = json.decodeFromString<CalendarEvent>(jsonStr)
        assertEquals("ev-100", parsed.id)
        assertTrue(parsed.is_dday)
        org.junit.Assert.assertFalse(parsed.is_cancelled)
    }

    @Test
    fun testWidgetConstants() {
        assertEquals("com.example.moacalendar.ACTION_REFRESH_WIDGET", com.example.moacalendar.widget.MoaCalendarWidgetProvider.ACTION_REFRESH_WIDGET)
        assertEquals("com.example.moacalendar.ACTION_REFRESH_MONTH_WIDGET", com.example.moacalendar.widget.MoaMonthWidgetProvider.ACTION_REFRESH_MONTH_WIDGET)
        assertEquals("com.example.moacalendar.ACTION_MONTH_PREV", com.example.moacalendar.widget.MoaMonthWidgetProvider.ACTION_MONTH_PREV)
        assertEquals("com.example.moacalendar.ACTION_MONTH_NEXT", com.example.moacalendar.widget.MoaMonthWidgetProvider.ACTION_MONTH_NEXT)
        assertEquals("com.example.moacalendar.ACTION_MONTH_TODAY", com.example.moacalendar.widget.MoaMonthWidgetProvider.ACTION_MONTH_TODAY)
    }

    @Test
    fun testMonthWidgetGridBorderColors() {
        val file = java.io.File("src/main/res/layout/widget_moa_month.xml")
        val content = file.readText()

        // 주단위 가로선은 조금 더 진한 색 (#DDE4DF, 6개: 요일 헤더 아래 + 5개 주 사이)
        val weekDividers = Regex("""#DDE4DF""").findAll(content).count()
        assertEquals(6, weekDividers)

        // 날짜 세로선은 연한 색 (#EEF3F0, 36개: 6개 행 x 6개 셀 경계)
        val dayDividers = Regex("""#EEF3F0""").findAll(content).count()
        assertEquals(36, dayDividers)
    }

    @Test
    fun testGetEventDateRange() {
        // 1. Single-day event
        val singleDay = CalendarEvent(
            id = "s1",
            calendar_id = "c1",
            title = "단일 일정",
            start = "2026-11-10T10:00",
            end = "2026-11-10T11:00"
        )
        val rangeSingle = MoaMonthWidgetProvider.getEventDateRange(singleDay)
        assertNotNull(rangeSingle)
        assertEquals(LocalDate.of(2026, 11, 10), rangeSingle?.startDate)
        assertEquals(LocalDate.of(2026, 11, 10), rangeSingle?.endDate)
        assertFalse(rangeSingle!!.isMultiDay)

        // 2. Multi-day event (2 days)
        val twoDay = CalendarEvent(
            id = "m1",
            calendar_id = "c1",
            title = "1박 2일 워크숍",
            start = "2026-11-10",
            end = "2026-11-11"
        )
        val rangeTwo = MoaMonthWidgetProvider.getEventDateRange(twoDay)
        assertNotNull(rangeTwo)
        assertEquals(LocalDate.of(2026, 11, 10), rangeTwo?.startDate)
        assertEquals(LocalDate.of(2026, 11, 11), rangeTwo?.endDate)
        assertTrue(rangeTwo!!.isMultiDay)

        // 3. Multi-day event with time (3 days)
        val threeDay = CalendarEvent(
            id = "m2",
            calendar_id = "c1",
            title = "제주 여행",
            start = "2026-11-10T14:00",
            end = "2026-11-12T18:00"
        )
        val rangeThree = MoaMonthWidgetProvider.getEventDateRange(threeDay)
        assertNotNull(rangeThree)
        assertEquals(LocalDate.of(2026, 11, 10), rangeThree?.startDate)
        assertEquals(LocalDate.of(2026, 11, 12), rangeThree?.endDate)
        assertTrue(rangeThree!!.isMultiDay)

        // 4. Midnight exclusive single-day (T00:00:00)
        val midnightSingle = CalendarEvent(
            id = "s2",
            calendar_id = "c1",
            title = "종일 일정",
            start = "2026-11-10T00:00:00",
            end = "2026-11-11T00:00:00"
        )
        val rangeMidnightSingle = MoaMonthWidgetProvider.getEventDateRange(midnightSingle)
        assertNotNull(rangeMidnightSingle)
        assertEquals(LocalDate.of(2026, 11, 10), rangeMidnightSingle?.startDate)
        assertEquals(LocalDate.of(2026, 11, 10), rangeMidnightSingle?.endDate)
        assertFalse(rangeMidnightSingle!!.isMultiDay)

        // 5. Midnight exclusive multi-day (2 days: 10th and 11th)
        val midnightMulti = CalendarEvent(
            id = "m3",
            calendar_id = "c1",
            title = "2일 일정",
            start = "2026-11-10T00:00",
            end = "2026-11-12T00:00"
        )
        val rangeMidnightMulti = MoaMonthWidgetProvider.getEventDateRange(midnightMulti)
        assertNotNull(rangeMidnightMulti)
        assertEquals(LocalDate.of(2026, 11, 10), rangeMidnightMulti?.startDate)
        assertEquals(LocalDate.of(2026, 11, 11), rangeMidnightMulti?.endDate)
        assertTrue(rangeMidnightMulti!!.isMultiDay)
    }

    @Test
    fun testAllocateWeekSlotsMultiDayBars() {
        val weekDates = (8..14).map { day -> LocalDate.of(2026, 11, day) } // Sun 11/8 ~ Sat 11/14

        val evA = CalendarEvent(
            id = "ev-a",
            calendar_id = "c1",
            title = "일정 A",
            start = "2026-11-11", // Wed (col 3)
            end = "2026-11-13",   // Fri (col 5)
            color = "sage"
        )

        val evB = CalendarEvent(
            id = "ev-b",
            calendar_id = "c1",
            title = "일정 B",
            start = "2026-11-10", // Tue (col 2)
            end = "2026-11-12",   // Thu (col 4)
            color = "peach"
        )

        val singleSun = CalendarEvent(
            id = "ev-sun",
            calendar_id = "c1",
            title = "일요일 일정",
            start = "2026-11-08T10:00",
            end = "2026-11-08T11:00",
            color = "blue"
        )

        val cancelledEv = CalendarEvent(
            id = "ev-cancel",
            calendar_id = "c1",
            title = "취소된 일정",
            start = "2026-11-10",
            end = "2026-11-12",
            is_cancelled = true
        )

        val allocation = MoaMonthWidgetProvider.allocateWeekSlots(weekDates, listOf(evA, evB, singleSun, cancelledEv))
        assertEquals(7, allocation.size)

        // Col 0 (Sunday): singleSun in slot 0
        assertEquals(1, allocation[0].size)
        assertEquals("ev-sun", allocation[0][0]?.event?.id)
        assertFalse(allocation[0][0]?.isMultiDay ?: true)

        // Col 1 (Monday): empty
        assertEquals(0, allocation[1].size)

        // Col 2 (Tuesday): evB in slot 0
        assertEquals("ev-b", allocation[2][0]?.event?.id)
        assertTrue(allocation[2][0]?.isMultiDay ?: false)

        // Col 3 (Wednesday): evB in slot 0, evA in slot 1 (overlapping)
        assertEquals("ev-b", allocation[3][0]?.event?.id)
        assertEquals("ev-a", allocation[3][1]?.event?.id)

        // Col 4 (Thursday): evB in slot 0, evA in slot 1 (overlapping)
        assertEquals("ev-b", allocation[4][0]?.event?.id)
        assertEquals("ev-a", allocation[4][1]?.event?.id)

        // Col 5 (Friday): slot 0 is null (spacer), slot 1 is evA (horizontal bar continuity!)
        assertNull(allocation[5][0])
        assertEquals("ev-a", allocation[5][1]?.event?.id)

        // Col 6 (Saturday): empty
        assertEquals(0, allocation[6].size)
    }
}
