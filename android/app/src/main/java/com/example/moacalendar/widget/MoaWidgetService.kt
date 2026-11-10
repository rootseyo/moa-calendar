package com.example.moacalendar.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.example.moacalendar.R
import com.example.moacalendar.data.MoaRepository
import com.example.moacalendar.model.CalendarEvent
import com.example.moacalendar.model.EventColors
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

class MoaWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return MoaRemoteViewsFactory(applicationContext, intent.getBooleanExtra("weekly", false))
    }
}

class MoaRemoteViewsFactory(private val context: Context, private val weekly: Boolean) : RemoteViewsService.RemoteViewsFactory {

    private var eventsList: List<CalendarEvent> = emptyList()

    override fun onCreate() {
        fetchData()
    }

    override fun onDataSetChanged() {
        fetchData()
    }

    private fun fetchData() {
        if (weekly) {
            val today = LocalDate.now()
            val start = today.minusDays((today.dayOfWeek.value % 7).toLong()).toString()
            val end = today.plusDays((6 - today.dayOfWeek.value % 7).toLong()).toString()
            eventsList = MoaRepository.getInstance(context).events.value.filter { event ->
                !event.is_cancelled && event.start.substringBefore("T") <= end && event.end.substringBefore("T") >= start
            }.sortedBy { it.start }
        } else {
            eventsList = MoaRepository.getTodayEventsForWidget(context).second
        }
    }

    override fun onDestroy() {
        eventsList = emptyList()
    }

    override fun getCount(): Int = eventsList.size

    override fun getViewAt(position: Int): RemoteViews {
        if (position !in eventsList.indices) {
            return RemoteViews(context.packageName, R.layout.widget_event_item)
        }

        val event = eventsList[position]
        val rv = RemoteViews(context.packageName, R.layout.widget_event_item)

        // Event Title
        rv.setTextViewText(R.id.widget_item_title, event.title)

        // Event Date & Time Format
        val todayStr = LocalDate.now().toString()
        val tomorrowStr = LocalDate.now().plusDays(1).toString()
        val eventStartDay = event.start.substringBefore("T")
        val datePrefix = when (eventStartDay) {
            todayStr -> "오늘"
            tomorrowStr -> "내일"
            else -> {
                try {
                    val d = LocalDate.parse(eventStartDay)
                    val dayOfWeek = d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.KOREAN)
                    "${d.monthValue}/${d.dayOfMonth} ($dayOfWeek)"
                } catch (e: Exception) {
                    eventStartDay
                }
            }
        }

        val timeText = if (event.all_day) {
            "$datePrefix · 하루 종일"
        } else {
            val startTime = event.start.substringAfter("T", "")
            val endTime = event.end.substringAfter("T", "")
            if (startTime.isNotBlank() && endTime.isNotBlank()) {
                "$datePrefix · $startTime ~ $endTime"
            } else if (startTime.isNotBlank()) {
                "$datePrefix · $startTime"
            } else {
                "$datePrefix · 시간 미정"
            }
        }
        rv.setTextViewText(R.id.widget_item_time, timeText)

        // Category Tag
        if (event.category.isNotBlank()) {
            rv.setTextViewText(R.id.widget_item_category, "· ${event.category}")
        } else {
            rv.setTextViewText(R.id.widget_item_category, "")
        }

        // Color Bar
        val colorHex = EventColors.getColor(event.color)
        val colorInt = colorHex.toInt()
        rv.setInt(R.id.widget_item_color_bar, "setBackgroundColor", colorInt)

        // Item Click Fill-in Intent with URL deep link
        val fillInIntent = Intent().apply {
            data = Uri.parse("https://dwm.brightnetworks.kr/?event_id=${event.id}&date=$eventStartDay")
            putExtra(MoaCalendarWidgetProvider.EXTRA_EVENT_ID, event.id)
            putExtra(MoaCalendarWidgetProvider.EXTRA_EVENT_DATE, eventStartDay)
        }
        rv.setOnClickFillInIntent(R.id.widget_item_container, fillInIntent)

        return rv
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount(): Int = 1

    override fun getItemId(position: Int): Long = position.toLong()

    override fun hasStableIds(): Boolean = true
}
