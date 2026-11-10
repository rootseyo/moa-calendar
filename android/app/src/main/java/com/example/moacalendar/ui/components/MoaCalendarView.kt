package com.example.moacalendar.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.moacalendar.model.CalendarEvent
import com.example.moacalendar.model.EventColors
import com.example.moacalendar.model.KoreaHolidays
import com.example.moacalendar.theme.MoaGreen
import com.example.moacalendar.theme.MoaSaturdayBlue
import com.example.moacalendar.theme.MoaSundayRed
import com.example.moacalendar.ui.CalendarViewMode
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

@Composable
fun MoaCalendarHeader(
    currentMonth: YearMonth,
    selectedDate: LocalDate,
    viewMode: CalendarViewMode,
    onViewModeChange: (CalendarViewMode) -> Unit,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onGoToToday: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(Color.White)
            .padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
        // Month / Title row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                val headerTitle = when (viewMode) {
                    CalendarViewMode.MONTH -> "${currentMonth.year}년 ${currentMonth.monthValue}월"
                    CalendarViewMode.WEEK -> "${selectedDate.year}년 ${selectedDate.monthValue}월 주간"
                    CalendarViewMode.DAY -> "${selectedDate.monthValue}월 ${selectedDate.dayOfMonth}일 (${selectedDate.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.KOREAN)})"
                }
                Text(
                    text = headerTitle,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(
                    onClick = onGoToToday,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.height(34.dp)
                ) {
                    Text(text = "오늘", fontSize = 12.sp, color = MoaGreen)
                }
                IconButton(onClick = onPrev, modifier = Modifier.size(36.dp)) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "이전",
                        tint = MoaGreen
                    )
                }
                IconButton(onClick = onNext, modifier = Modifier.size(36.dp)) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                        contentDescription = "다음",
                        tint = MoaGreen
                    )
                }
            }
        }

        // View Mode Toggle (월간 / 주간 / 일간)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            listOf(
                CalendarViewMode.MONTH to "월간",
                CalendarViewMode.WEEK to "주간",
                CalendarViewMode.DAY to "일간"
            ).forEach { (mode, label) ->
                val isSelected = viewMode == mode
                FilterChip(
                    selected = isSelected,
                    onClick = { onViewModeChange(mode) },
                    label = { Text(label, fontSize = 11.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MoaGreen,
                        selectedLabelColor = Color.White
                    ),
                    modifier = Modifier.height(30.dp)
                )
            }
        }
    }
}

@Composable
fun MoaCalendarGrid(
    currentMonth: YearMonth,
    selectedDate: LocalDate,
    events: List<CalendarEvent>,
    onDateSelected: (LocalDate) -> Unit,
    modifier: Modifier = Modifier
) {
    val daysOfWeek = listOf(
        DayOfWeek.SUNDAY,
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
        DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY,
        DayOfWeek.SATURDAY
    )

    Column(modifier = modifier.fillMaxWidth().padding(horizontal = 6.dp)) {
        // Weekday header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFFF7F9F5), RoundedCornerShape(8.dp))
                .padding(vertical = 6.dp)
        ) {
            daysOfWeek.forEach { dayOfWeek ->
                val textColor = when (dayOfWeek) {
                    DayOfWeek.SUNDAY -> MoaSundayRed
                    DayOfWeek.SATURDAY -> MoaSaturdayBlue
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                }
                Text(
                    text = dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.KOREAN),
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.Center,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = textColor
                )
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        val firstDayOfMonth = currentMonth.atDay(1)
        val firstDayOfWeek = firstDayOfMonth.dayOfWeek
        val offset = (firstDayOfWeek.value % 7)
        val startDate = firstDayOfMonth.minusDays(offset.toLong())
        val weeks = 6

        for (week in 0 until weeks) {
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 1.dp)) {
                for (day in 0 until 7) {
                    val date = startDate.plusDays((week * 7 + day).toLong())
                    val isCurrentMonth = YearMonth.from(date) == currentMonth
                    val isSelected = date == selectedDate
                    val isToday = date == LocalDate.now()

                    val dateStr = date.format(DateTimeFormatter.ISO_LOCAL_DATE)
                    val holidayName = KoreaHolidays.getHoliday(dateStr)

                    val dateEvents = events.filter { ev ->
                        val start = ev.start.substringBefore("T")
                        val end = ev.end.substringBefore("T")
                        start <= dateStr && dateStr <= end
                    }

                    CalendarDayCell(
                        date = date,
                        holidayName = holidayName,
                        isCurrentMonth = isCurrentMonth,
                        isSelected = isSelected,
                        isToday = isToday,
                        events = dateEvents,
                        onDateSelected = onDateSelected,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }
    }
}

@Composable
fun CalendarDayCell(
    date: LocalDate,
    holidayName: String?,
    isCurrentMonth: Boolean,
    isSelected: Boolean,
    isToday: Boolean,
    events: List<CalendarEvent>,
    onDateSelected: (LocalDate) -> Unit,
    modifier: Modifier = Modifier
) {
    val dayOfWeek = date.dayOfWeek
    val isHoliday = holidayName != null

    val dayTextColor = when {
        !isCurrentMonth -> MaterialTheme.colorScheme.outline.copy(alpha = 0.35f)
        isSelected -> Color.White
        isHoliday || dayOfWeek == DayOfWeek.SUNDAY -> MoaSundayRed
        dayOfWeek == DayOfWeek.SATURDAY -> MoaSaturdayBlue
        else -> MaterialTheme.colorScheme.onSurface
    }

    val cellBackground = when {
        isSelected -> MoaGreen
        isToday -> Color(0xFFE2F2E5)
        else -> Color.Transparent
    }

    Column(
        modifier = modifier
            .height(54.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(cellBackground)
            .clickable { onDateSelected(date) }
            .padding(2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = date.dayOfMonth.toString(),
                fontSize = 12.sp,
                fontWeight = if (isToday || isSelected) FontWeight.Bold else FontWeight.Normal,
                color = dayTextColor,
                textAlign = TextAlign.Center
            )
            if (holidayName != null && isCurrentMonth) {
                Text(
                    text = holidayName,
                    fontSize = 8.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = if (isSelected) Color.White.copy(alpha = 0.9f) else MoaSundayRed
                )
            }
        }

        // Event Pills / Dots
        Row(
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(bottom = 2.dp)
        ) {
            val displayEvents = events.take(3)
            displayEvents.forEach { ev ->
                val primaryColor = Color(EventColors.getColor(ev.color))
                Box(
                    modifier = Modifier
                        .padding(horizontal = 1.dp)
                        .size(5.dp)
                        .background(if (isSelected) Color.White else primaryColor, CircleShape)
                )
            }
            if (events.size > 3) {
                Box(
                    modifier = Modifier
                        .padding(horizontal = 1.dp)
                        .size(3.dp)
                        .background(if (isSelected) Color.White else Color.Gray, CircleShape)
                )
            }
        }
    }
}
