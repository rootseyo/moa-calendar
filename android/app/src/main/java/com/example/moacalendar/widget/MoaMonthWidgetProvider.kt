package com.example.moacalendar.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import com.example.moacalendar.MainActivity
import com.example.moacalendar.R
import com.example.moacalendar.data.MoaRepository
import com.example.moacalendar.model.CalendarEvent
import com.example.moacalendar.model.EventColors
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

class MoaMonthWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateMonthWidget(context, appWidgetManager, appWidgetId)
        }
        super.onUpdate(context, appWidgetManager, appWidgetIds)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val appWidgetManager = AppWidgetManager.getInstance(context)

        when (intent.action) {
            ACTION_MONTH_PREV -> {
                val appWidgetId = intent.getIntExtra(
                    AppWidgetManager.EXTRA_APPWIDGET_ID,
                    AppWidgetManager.INVALID_APPWIDGET_ID
                )
                if (appWidgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                    val currentYm = loadYearMonth(context, appWidgetId)
                    val newYm = currentYm.minusMonths(1)
                    saveYearMonth(context, appWidgetId, newYm)
                    updateMonthWidget(context, appWidgetManager, appWidgetId)
                }
            }

            ACTION_MONTH_NEXT -> {
                val appWidgetId = intent.getIntExtra(
                    AppWidgetManager.EXTRA_APPWIDGET_ID,
                    AppWidgetManager.INVALID_APPWIDGET_ID
                )
                if (appWidgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                    val currentYm = loadYearMonth(context, appWidgetId)
                    val newYm = currentYm.plusMonths(1)
                    saveYearMonth(context, appWidgetId, newYm)
                    updateMonthWidget(context, appWidgetManager, appWidgetId)
                }
            }

            ACTION_MONTH_TODAY -> {
                val appWidgetId = intent.getIntExtra(
                    AppWidgetManager.EXTRA_APPWIDGET_ID,
                    AppWidgetManager.INVALID_APPWIDGET_ID
                )
                if (appWidgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                    saveYearMonth(context, appWidgetId, YearMonth.now())
                    updateMonthWidget(context, appWidgetManager, appWidgetId)
                }
            }

            ACTION_REFRESH_MONTH_WIDGET, AppWidgetManager.ACTION_APPWIDGET_UPDATE -> {
                val thisWidget = ComponentName(context, MoaMonthWidgetProvider::class.java)
                val appWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget)
                for (appWidgetId in appWidgetIds) {
                    updateMonthWidget(context, appWidgetManager, appWidgetId)
                }
            }
        }
    }

    data class CellIdHolder(
        val containerId: Int,
        val bgId: Int,
        val textId: Int,
        val event1Id: Int,
        val event2Id: Int,
        val event3Id: Int
    )

    data class EventDateRange(
        val startDate: LocalDate,
        val endDate: LocalDate,
        val isMultiDay: Boolean
    )

    data class EventWeekMeta(
        val event: CalendarEvent,
        val startDate: LocalDate,
        val endDate: LocalDate,
        val isMultiDay: Boolean,
        val startCol: Int,
        val endCol: Int,
        val span: Int
    )

    companion object {
        const val ACTION_REFRESH_MONTH_WIDGET = "com.example.moacalendar.ACTION_REFRESH_MONTH_WIDGET"
        const val ACTION_MONTH_PREV = "com.example.moacalendar.ACTION_MONTH_PREV"
        const val ACTION_MONTH_NEXT = "com.example.moacalendar.ACTION_MONTH_NEXT"
        const val ACTION_MONTH_TODAY = "com.example.moacalendar.ACTION_MONTH_TODAY"

        private const val PREFS_NAME = "moa_month_widget_prefs"
        private const val KEY_PREFIX = "year_month_"

        private var cachedCellIds: List<CellIdHolder>? = null

        private fun getCellIds(context: Context): List<CellIdHolder> {
            cachedCellIds?.let { return it }
            val pkg = context.packageName
            val res = context.resources
            val list = (0 until 42).map { i ->
                CellIdHolder(
                    containerId = res.getIdentifier("cell_$i", "id", pkg),
                    bgId = res.getIdentifier("cell_bg_$i", "id", pkg),
                    textId = res.getIdentifier("cell_text_$i", "id", pkg),
                    event1Id = res.getIdentifier("cell_event1_$i", "id", pkg),
                    event2Id = res.getIdentifier("cell_event2_$i", "id", pkg),
                    event3Id = res.getIdentifier("cell_event3_$i", "id", pkg)
                )
            }
            cachedCellIds = list
            return list
        }

        private fun loadYearMonth(context: Context, appWidgetId: Int): YearMonth {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val str = prefs.getString("$KEY_PREFIX$appWidgetId", null)
            return if (!str.isNullOrBlank()) {
                try {
                    YearMonth.parse(str)
                } catch (e: Exception) {
                    YearMonth.now()
                }
            } else {
                YearMonth.now()
            }
        }

        private fun saveYearMonth(context: Context, appWidgetId: Int, ym: YearMonth) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString("$KEY_PREFIX$appWidgetId", ym.toString()).apply()
        }

        fun updateMonthWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_moa_month)
            val ym = loadYearMonth(context, appWidgetId)
            val today = LocalDate.now()

            // 1. Month Title (e.g. "2026년 11월")
            val titleText = ym.format(DateTimeFormatter.ofPattern("yyyy년 M월", Locale.KOREAN))
            views.setTextViewText(R.id.widget_month_title, titleText)

            // Open app on title or icon click
            val appIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                data = Uri.parse("https://dwm.brightnetworks.kr")
            }
            val appPendingIntent = PendingIntent.getActivity(
                context,
                appWidgetId,
                appIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_month_title, appPendingIntent)
            views.setOnClickPendingIntent(R.id.widget_month_icon, appPendingIntent)

            // 2. Previous Month Button (<)
            val prevIntent = Intent(context, MoaMonthWidgetProvider::class.java).apply {
                action = ACTION_MONTH_PREV
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            }
            val prevPendingIntent = PendingIntent.getBroadcast(
                context,
                appWidgetId * 10 + 1,
                prevIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_prev_month, prevPendingIntent)

            // 3. Today Button
            val todayIntent = Intent(context, MoaMonthWidgetProvider::class.java).apply {
                action = ACTION_MONTH_TODAY
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            }
            val todayPendingIntent = PendingIntent.getBroadcast(
                context,
                appWidgetId * 10 + 2,
                todayIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_today_month, todayPendingIntent)

            // 4. Next Month Button (>)
            val nextIntent = Intent(context, MoaMonthWidgetProvider::class.java).apply {
                action = ACTION_MONTH_NEXT
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            }
            val nextPendingIntent = PendingIntent.getBroadcast(
                context,
                appWidgetId * 10 + 3,
                nextIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_next_month, nextPendingIntent)

            // 5. Quick Add Button (+)
            val addIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                data = Uri.parse("https://dwm.brightnetworks.kr/?action=new_event&date=$today")
                putExtra(MoaCalendarWidgetProvider.EXTRA_ACTION, MoaCalendarWidgetProvider.ACTION_NEW_EVENT)
                putExtra(MoaCalendarWidgetProvider.EXTRA_EVENT_DATE, today.toString())
            }
            val addPendingIntent = PendingIntent.getActivity(
                context,
                appWidgetId * 10 + 4,
                addIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_add_month, addPendingIntent)

            // 6. Build Events Index by Date & Filter non-cancelled events
            val allEvents = MoaRepository.getInstance(context).events.value
            val nonCancelledEvents = allEvents.filter { !it.is_cancelled }
            val eventsByDate = mutableMapOf<String, MutableList<CalendarEvent>>()
            for (ev in nonCancelledEvents) {
                val range = getEventDateRange(ev) ?: continue
                var d = range.startDate
                var loopCount = 0
                while (!d.isAfter(range.endDate) && loopCount < 366) {
                    eventsByDate.getOrPut(d.toString()) { mutableListOf() }.add(ev)
                    d = d.plusDays(1)
                    loopCount++
                }
            }

            // 7. Populate 42 Calendar Cells
            val firstOfMonth = ym.atDay(1)
            // Sunday-first: Sunday is 0, Monday is 1, ..., Saturday is 6
            val dayOfWeekOffset = firstOfMonth.dayOfWeek.value % 7
            val gridStartDate = firstOfMonth.minusDays(dayOfWeekOffset.toLong())

            val weekAllocations = (0 until 6).map { w ->
                val weekDates = (0 until 7).map { c -> gridStartDate.plusDays((w * 7 + c).toLong()) }
                allocateWeekSlots(weekDates, nonCancelledEvents)
            }

            val cellIds = getCellIds(context)
            for (i in 0 until 42) {
                val holder = cellIds.getOrNull(i) ?: continue
                val weekIndex = i / 7
                val col = i % 7
                val cellDate = gridStartDate.plusDays(i.toLong())
                val cellDateStr = cellDate.toString()
                val isCurrentMonth = cellDate.month == ym.month
                val isToday = cellDate == today
                val isSunday = cellDate.dayOfWeek == DayOfWeek.SUNDAY
                val isSaturday = cellDate.dayOfWeek == DayOfWeek.SATURDAY

                // Text
                views.setTextViewText(holder.textId, cellDate.dayOfMonth.toString())

                // Text Color
                val textColor = when {
                    isToday -> Color.WHITE
                    !isCurrentMonth -> Color.parseColor("#C2CDC5")
                    isSunday -> Color.parseColor("#DC2626")
                    isSaturday -> Color.parseColor("#2563EB")
                    else -> Color.parseColor("#1E3328")
                }
                views.setTextColor(holder.textId, textColor)

                // Today Highlight Background
                if (isToday) {
                    views.setInt(holder.bgId, "setBackgroundResource", R.drawable.widget_today_circle)
                } else {
                    views.setInt(holder.bgId, "setBackgroundColor", Color.TRANSPARENT)
                }

                // Render slots 0 and 1 from weekly allocation
                val colSlots = weekAllocations[weekIndex][col]
                val slot0 = colSlots.getOrNull(0)
                val slot1 = colSlots.getOrNull(1)

                when {
                    slot0 != null && slot1 != null -> {
                        renderEventSlot(views, holder.event1Id, slot0, cellDate, col)
                        renderEventSlot(views, holder.event2Id, slot1, cellDate, col)
                    }
                    slot0 != null && slot1 == null -> {
                        renderEventSlot(views, holder.event1Id, slot0, cellDate, col)
                        views.setViewVisibility(holder.event2Id, View.GONE)
                        views.setInt(holder.event2Id, "setBackgroundColor", Color.TRANSPARENT)
                    }
                    slot0 == null && slot1 != null -> {
                        // Invisible spacer for slot 0 preserves slot 1 row alignment across days
                        views.setViewVisibility(holder.event1Id, View.INVISIBLE)
                        views.setTextViewText(holder.event1Id, "\u00A0")
                        views.setInt(holder.event1Id, "setBackgroundColor", Color.TRANSPARENT)
                        renderEventSlot(views, holder.event2Id, slot1, cellDate, col)
                    }
                    else -> {
                        views.setViewVisibility(holder.event1Id, View.GONE)
                        views.setInt(holder.event1Id, "setBackgroundColor", Color.TRANSPARENT)
                        views.setViewVisibility(holder.event2Id, View.GONE)
                        views.setInt(holder.event2Id, "setBackgroundColor", Color.TRANSPARENT)
                    }
                }

                // Overflow count (+N)
                val dayEvents = eventsByDate[cellDateStr].orEmpty()
                var renderedCount = 0
                if (slot0 != null) renderedCount++
                if (slot1 != null) renderedCount++
                val remaining = maxOf(0, dayEvents.size - renderedCount)
                if (remaining > 0) {
                    views.setViewVisibility(holder.event3Id, View.VISIBLE)
                    views.setTextViewText(holder.event3Id, "+$remaining")
                    views.setTextColor(holder.event3Id, Color.parseColor("#38664E"))
                    views.setInt(holder.event3Id, "setBackgroundColor", Color.TRANSPARENT)
                } else {
                    views.setViewVisibility(holder.event3Id, View.GONE)
                    views.setInt(holder.event3Id, "setBackgroundColor", Color.TRANSPARENT)
                }

                // Click on cell -> Open app with that date selected
                val cellClickIntent = Intent(context, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    data = Uri.parse("https://dwm.brightnetworks.kr/?date=$cellDateStr")
                    putExtra(MoaCalendarWidgetProvider.EXTRA_EVENT_DATE, cellDateStr)
                }
                val cellPendingIntent = PendingIntent.getActivity(
                    context,
                    appWidgetId * 100 + i + 1000,
                    cellClickIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(holder.containerId, cellPendingIntent)
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        fun getEventDateRange(ev: CalendarEvent): EventDateRange? {
            val sRaw = ev.start.ifEmpty { return null }
            val eRaw = ev.end.ifEmpty { ev.start }
            val sDateStr = sRaw.substringBefore("T")
            val startDate = try { LocalDate.parse(sDateStr) } catch (e: Exception) { return null }

            val eDateStr = eRaw.substringBefore("T")
            var parsedEndDate = try { LocalDate.parse(eDateStr) } catch (e: Exception) { startDate }

            // If eRaw specifies midnight time (e.g., T00:00 or T00:00:00), end date is exclusive
            val timePart = if (eRaw.contains("T")) eRaw.substringAfter("T") else ""
            if (timePart.matches(Regex("^00:00(?::00(\\.\\d+)?)?$"))) {
                parsedEndDate = parsedEndDate.minusDays(1)
            }

            val endDate = if (parsedEndDate.isBefore(startDate)) startDate else parsedEndDate
            val isMultiDay = endDate.isAfter(startDate)
            return EventDateRange(startDate, endDate, isMultiDay)
        }

        fun allocateWeekSlots(
            weekDates: List<LocalDate>,
            events: List<CalendarEvent>
        ): List<List<EventWeekMeta?>> {
            require(weekDates.size == 7) { "weekDates must contain exactly 7 dates" }
            val weekStart = weekDates.first()
            val weekEnd = weekDates.last()

            val eventMetas = mutableListOf<EventWeekMeta>()
            for (ev in events) {
                if (ev.is_cancelled) continue
                val range = getEventDateRange(ev) ?: continue
                if (!range.startDate.isAfter(weekEnd) && !range.endDate.isBefore(weekStart)) {
                    val startCol = if (range.startDate.isBefore(weekStart)) {
                        0
                    } else {
                        ChronoUnit.DAYS.between(weekStart, range.startDate).toInt().coerceIn(0, 6)
                    }
                    val endCol = if (range.endDate.isAfter(weekEnd)) {
                        6
                    } else {
                        ChronoUnit.DAYS.between(weekStart, range.endDate).toInt().coerceIn(0, 6)
                    }
                    val span = endCol - startCol + 1
                    eventMetas.add(
                        EventWeekMeta(
                            event = ev,
                            startDate = range.startDate,
                            endDate = range.endDate,
                            isMultiDay = range.isMultiDay,
                            startCol = startCol,
                            endCol = endCol,
                            span = span
                        )
                    )
                }
            }

            val sortedMetas = eventMetas.sortedWith(
                compareByDescending<EventWeekMeta> { it.isMultiDay }
                    .thenBy { it.startCol }
                    .thenByDescending { it.span }
                    .thenByDescending { it.event.all_day }
                    .thenBy { it.event.start }
                    .thenBy { it.event.id }
            )

            val colSlots = Array(7) { mutableListOf<EventWeekMeta?>() }
            for (meta in sortedMetas) {
                var slot = 0
                while (true) {
                    var conflict = false
                    for (c in meta.startCol..meta.endCol) {
                        if (colSlots[c].getOrNull(slot) != null) {
                            conflict = true
                            break
                        }
                    }
                    if (!conflict) break
                    slot++
                }
                for (c in meta.startCol..meta.endCol) {
                    while (colSlots[c].size <= slot) {
                        colSlots[c].add(null)
                    }
                    colSlots[c][slot] = meta
                }
            }

            return colSlots.map { it.toList() }
        }

        private fun renderEventSlot(
            views: RemoteViews,
            viewId: Int,
            meta: EventWeekMeta,
            cellDate: LocalDate,
            col: Int
        ) {
            views.setViewVisibility(viewId, View.VISIBLE)
            val event = meta.event
            if (meta.isMultiDay) {
                val bgColor = EventColors.getBgColor(event.color).toInt()
                val textColor = EventColors.getTextColor(event.color).toInt()
                views.setInt(viewId, "setBackgroundColor", bgColor)
                views.setTextColor(viewId, textColor)

                val showTitle = (cellDate == meta.startDate || col == 0)
                if (showTitle) {
                    val title = event.title.replace(Regex("[\\r\\n]+"), " ").trim()
                    val maxLen = minOf(6, title.codePointCount(0, title.length))
                    val end = title.offsetByCodePoints(0, maxLen)
                    views.setTextViewText(viewId, title.substring(0, end))
                } else {
                    views.setTextViewText(viewId, "\u00A0")
                }
            } else {
                views.setInt(viewId, "setBackgroundColor", Color.TRANSPARENT)
                views.setTextColor(viewId, EventColors.getColor(event.color).toInt())
                val title = event.title.replace(Regex("[\\r\\n]+"), " ").trim()
                val maxLen = minOf(6, title.codePointCount(0, title.length))
                val end = title.offsetByCodePoints(0, maxLen)
                views.setTextViewText(viewId, title.substring(0, end))
            }
        }

        fun notifyUpdate(context: Context) {
            val intent = Intent(context, MoaMonthWidgetProvider::class.java).apply {
                action = ACTION_REFRESH_MONTH_WIDGET
            }
            context.sendBroadcast(intent)
        }
    }
}
