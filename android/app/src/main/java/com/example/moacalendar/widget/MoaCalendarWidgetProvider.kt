package com.example.moacalendar.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import android.view.View
import com.example.moacalendar.MainActivity
import com.example.moacalendar.R
import com.example.moacalendar.data.MoaRepository
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

open class MoaCalendarWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId, this is MoaWeekWidgetProvider)
        }
        super.onUpdate(context, appWidgetManager, appWidgetIds)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH_WIDGET || intent.action == AppWidgetManager.ACTION_APPWIDGET_UPDATE) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val thisWidget = ComponentName(context, javaClass)
            val appWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget)
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.widget_event_list)
            for (appWidgetId in appWidgetIds) {
                updateAppWidget(context, appWidgetManager, appWidgetId, this is MoaWeekWidgetProvider)
            }
        }
    }

    companion object {
        const val ACTION_REFRESH_WIDGET = "com.example.moacalendar.ACTION_REFRESH_WIDGET"
        const val ACTION_NEW_EVENT = "new_event"
        const val EXTRA_ACTION = "com.example.moacalendar.EXTRA_ACTION"
        const val EXTRA_EVENT_ID = "com.example.moacalendar.EXTRA_EVENT_ID"
        const val EXTRA_EVENT_DATE = "com.example.moacalendar.EXTRA_EVENT_DATE"

        fun updateAppWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int, weekly: Boolean = false
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_moa_calendar)

            views.setViewVisibility(R.id.widget_btn_refresh, if (weekly) View.VISIBLE else View.GONE)

            // 1. Title and Today Date
            val (calName, _) = MoaRepository.getTodayEventsForWidget(context)
            views.setTextViewText(R.id.widget_title, calName)

            val today = LocalDate.now()
            val formatter = DateTimeFormatter.ofPattern("M월 d일 (E)", Locale.KOREAN)
            views.setTextViewText(R.id.widget_date, if (weekly) "이번 주 · ${today.minusDays((today.dayOfWeek.value % 7).toLong()).format(DateTimeFormatter.ofPattern("M/d"))} ~ ${today.plusDays((6 - today.dayOfWeek.value % 7).toLong()).format(DateTimeFormatter.ofPattern("M/d"))}" else "오늘 · ${today.format(formatter)}")

            // 2. Open App on root/title click
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
            views.setOnClickPendingIntent(R.id.widget_title, appPendingIntent)
            views.setOnClickPendingIntent(R.id.widget_icon, appPendingIntent)
            views.setOnClickPendingIntent(R.id.widget_header_title_layout, appPendingIntent)

            // 3. Quick Add Button (+)
            val addIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                data = Uri.parse("https://dwm.brightnetworks.kr/?action=new_event&date=$today")
                putExtra(EXTRA_ACTION, ACTION_NEW_EVENT)
                putExtra(EXTRA_EVENT_DATE, today.toString())
            }
            val addPendingIntent = PendingIntent.getActivity(
                context,
                appWidgetId + 20000,
                addIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_add, addPendingIntent)

            // 4. Refresh Button
            val refreshIntent = Intent(context, if (weekly) MoaWeekWidgetProvider::class.java else MoaCalendarWidgetProvider::class.java).apply {
                action = ACTION_REFRESH_WIDGET
            }
            val refreshPendingIntent = PendingIntent.getBroadcast(
                context,
                appWidgetId,
                refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_refresh, refreshPendingIntent)

            // 5. RemoteViews Service for List
            val serviceIntent = Intent(context, MoaWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                putExtra("weekly", weekly)
                data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            views.setRemoteAdapter(R.id.widget_event_list, serviceIntent)
            views.setEmptyView(R.id.widget_event_list, R.id.widget_empty_view)

            // 6. Item Click Template
            val clickIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val clickPendingIntent = PendingIntent.getActivity(
                context,
                appWidgetId + 30000,
                clickIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            views.setPendingIntentTemplate(R.id.widget_event_list, clickPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        fun notifyUpdate(context: Context) {
            val intent = Intent(context, MoaCalendarWidgetProvider::class.java).apply {
                action = ACTION_REFRESH_WIDGET
            }
            context.sendBroadcast(intent)
            context.sendBroadcast(Intent(context, MoaWeekWidgetProvider::class.java).apply { action = ACTION_REFRESH_WIDGET })
        }
    }
}

class MoaWeekWidgetProvider : MoaCalendarWidgetProvider()
