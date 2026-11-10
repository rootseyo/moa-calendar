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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.moacalendar.model.CalendarEvent
import com.example.moacalendar.model.EventColors
import com.example.moacalendar.theme.MoaGreen
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun EventListView(
    selectedDate: LocalDate,
    events: List<CalendarEvent>,
    onEventClick: (CalendarEvent) -> Unit,
    onToggleComplete: (CalendarEvent) -> Unit,
    modifier: Modifier = Modifier
) {
    val formatter = DateTimeFormatter.ofPattern("M월 d일 (E)", Locale.KOREAN)

    Column(modifier = modifier.fillMaxWidth().padding(horizontal = 14.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "${selectedDate.format(formatter)} 일정",
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = "${events.size}개",
                fontSize = 12.sp,
                color = MoaGreen,
                fontWeight = FontWeight.SemiBold
            )
        }

        if (events.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(110.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "오늘 예정된 일정이 없습니다.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.outline
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "+ 새로운 일정 버튼을 눌러 일정을 추가하세요",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.outlineVariant
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(events, key = { it.id }) { event ->
                    EventCard(
                        event = event,
                        onClick = { onEventClick(event) },
                        onToggleComplete = { onToggleComplete(event) }
                    )
                }
            }
        }
    }
}

@Composable
fun EventCard(
    event: CalendarEvent,
    onClick: () -> Unit,
    onToggleComplete: () -> Unit,
    modifier: Modifier = Modifier
) {
    val primaryColor = Color(EventColors.getColor(event.color))
    val bgColor = Color(EventColors.getBgColor(event.color))
    val textColor = Color(EventColors.getTextColor(event.color))

    Card(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = bgColor)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Web border-left indicator style
            Box(
                modifier = Modifier
                    .size(width = 3.dp, height = 34.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(primaryColor)
            )

            Spacer(modifier = Modifier.width(10.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = event.title,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        textDecoration = if (event.completed) TextDecoration.LineThrough else TextDecoration.None,
                        color = if (event.completed) Color.Gray else textColor
                    )
                    if (event.category.isNotBlank()) {
                        Spacer(modifier = Modifier.width(6.dp))
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(Color.White.copy(alpha = 0.7f))
                                .padding(horizontal = 5.dp, vertical = 2.dp)
                        ) {
                            Text(
                                text = event.category,
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Medium,
                                color = textColor
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(2.dp))

                val timeStr = if (event.all_day) {
                    "하루 종일"
                } else {
                    val sTime = event.start.substringAfter("T", "")
                    val eTime = event.end.substringAfter("T", "")
                    if (sTime.isNotBlank() && eTime.isNotBlank()) "$sTime ~ $eTime" else sTime
                }

                Text(
                    text = timeStr,
                    fontSize = 11.sp,
                    color = textColor.copy(alpha = 0.85f)
                )

                if (event.notes.isNotBlank()) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = event.notes,
                        fontSize = 10.sp,
                        maxLines = 1,
                        color = textColor.copy(alpha = 0.7f)
                    )
                }
            }

            if (event.is_todo) {
                IconButton(onClick = onToggleComplete, modifier = Modifier.size(32.dp)) {
                    Icon(
                        imageVector = if (event.completed) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
                        contentDescription = "완료",
                        tint = if (event.completed) MoaGreen else primaryColor
                    )
                }
            }
        }
    }
}
