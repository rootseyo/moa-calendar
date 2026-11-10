package com.example.moacalendar.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.moacalendar.model.CalendarEvent
import com.example.moacalendar.model.EventColors
import com.example.moacalendar.theme.MoaGreen

@Composable
fun EventEditorDialog(
    initialEvent: CalendarEvent,
    isNew: Boolean,
    onSave: (CalendarEvent, isNew: Boolean, repeatWeeks: Int) -> Unit,
    onDelete: (CalendarEvent) -> Unit,
    onDismiss: () -> Unit
) {
    var title by remember { mutableStateOf(initialEvent.title) }
    var start by remember { mutableStateOf(initialEvent.start) }
    var end by remember { mutableStateOf(initialEvent.end) }
    var color by remember { mutableStateOf(initialEvent.color) }
    var notes by remember { mutableStateOf(initialEvent.notes) }
    var category by remember { mutableStateOf(initialEvent.category) }
    var allDay by remember { mutableStateOf(initialEvent.all_day) }
    var isTodo by remember { mutableStateOf(initialEvent.is_todo) }
    var reminderEnabled by remember { mutableStateOf(initialEvent.reminder_enabled) }
    var reminderMinutes by remember { mutableIntStateOf(initialEvent.reminder_minutes) }
    var repeatWeeks by remember { mutableIntStateOf(1) }

    val scrollState = rememberScrollState()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = if (isNew) "새로운 일정" else "일정 수정",
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = MaterialTheme.colorScheme.onSurface
                )
                if (!isNew) {
                    IconButton(onClick = { onDelete(initialEvent) }) {
                        Icon(
                            imageVector = Icons.Default.Delete,
                            contentDescription = "일정 삭제",
                            tint = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(scrollState),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Title
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("일정 제목") },
                    placeholder = { Text("어떤 시간을 함께할까요?") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                // Category
                OutlinedTextField(
                    value = category,
                    onValueChange = { category = it },
                    label = { Text("카테고리") },
                    placeholder = { Text("예: 업무, 개인, 회의, 미팅") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                // 12 Color Palette (Web style.css swatch identical)
                Text("일정 색상", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    // Row 1 (6 colors)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        EventColors.PALETTE.take(6).forEach { paletteItem ->
                            val isSelected = color == paletteItem.key
                            val c = Color(paletteItem.primaryHex)
                            Box(
                                modifier = Modifier
                                    .size(32.dp)
                                    .clip(CircleShape)
                                    .background(c)
                                    .clickable { color = paletteItem.key },
                                contentAlignment = Alignment.Center
                            ) {
                                if (isSelected) {
                                    Icon(
                                        imageVector = Icons.Default.Check,
                                        contentDescription = paletteItem.name,
                                        tint = Color.White,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                        }
                    }
                    // Row 2 (6 colors)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        EventColors.PALETTE.drop(6).forEach { paletteItem ->
                            val isSelected = color == paletteItem.key
                            val c = Color(paletteItem.primaryHex)
                            Box(
                                modifier = Modifier
                                    .size(32.dp)
                                    .clip(CircleShape)
                                    .background(c)
                                    .clickable { color = paletteItem.key },
                                contentAlignment = Alignment.Center
                            ) {
                                if (isSelected) {
                                    Icon(
                                        imageVector = Icons.Default.Check,
                                        contentDescription = paletteItem.name,
                                        tint = Color.White,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                        }
                    }
                }

                // All day toggle
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("하루 종일", fontSize = 14.sp)
                    Switch(
                        checked = allDay,
                        onCheckedChange = { isChecked ->
                            allDay = isChecked
                            val sDate = start.substringBefore("T")
                            val eDate = end.substringBefore("T")
                            if (isChecked) {
                                start = "${sDate}T00:00"
                                end = "${eDate}T00:00"
                            } else {
                                start = "${sDate}T10:00"
                                end = "${eDate}T11:00"
                            }
                        }
                    )
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = reminderEnabled, onCheckedChange = { reminderEnabled = it })
                    Text("알림 받기", fontSize = 14.sp)
                    Spacer(modifier = Modifier.weight(1f))
                    TextButton(onClick = {
                        val choices = listOf(10, 30) + (1..23).map { it * 60 } + 1440
                        reminderMinutes = choices[(choices.indexOf(reminderMinutes).coerceAtLeast(0) + 1) % choices.size]
                    }, enabled = reminderEnabled) {
                        Text(when { reminderMinutes == 1440 -> "하루 전"; reminderMinutes >= 60 -> "${reminderMinutes / 60}시간 전"; else -> "${reminderMinutes}분 전" })
                    }
                }

                // Start / End
                OutlinedTextField(
                    value = start,
                    onValueChange = { start = it },
                    label = { Text("시작 시간") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                OutlinedTextField(
                    value = end,
                    onValueChange = { end = it },
                    label = { Text("종료 시간") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                // Notes
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("일정 내용 (메모)") },
                    placeholder = { Text("장소나 함께 알아둘 내용을 적어주세요.") },
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 3
                )

                // Todo checkbox
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.clickable { isTodo = !isTodo }
                ) {
                    Checkbox(checked = isTodo, onCheckedChange = { isTodo = it })
                    Text("To Do 로 등록", fontSize = 14.sp)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (title.isNotBlank()) {
                        val updated = initialEvent.copy(
                            title = title.trim(),
                            start = start,
                            end = end,
                            color = color,
                            notes = notes,
                            category = category.trim(),
                            all_day = allDay,
                            is_todo = isTodo,
                            reminder_enabled = reminderEnabled,
                            reminder_minutes = reminderMinutes
                        )
                        onSave(updated, isNew, repeatWeeks)
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = MoaGreen),
                enabled = title.isNotBlank()
            ) {
                Text("일정 저장")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("닫기")
            }
        }
    )
}
