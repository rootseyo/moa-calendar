package com.example.moacalendar.ui.main

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.moacalendar.model.EventColors
import com.example.moacalendar.theme.MoaGreen
import com.example.moacalendar.ui.MoaCalendarViewModel
import com.example.moacalendar.ui.components.EventEditorDialog
import com.example.moacalendar.ui.components.EventListView
import com.example.moacalendar.ui.components.MoaCalendarGrid
import com.example.moacalendar.ui.components.MoaCalendarHeader
import com.example.moacalendar.ui.components.NewCalendarDialog

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    modifier: Modifier = Modifier,
    viewModel: MoaCalendarViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var calendarMenuExpanded by remember { mutableStateOf(false) }

    LaunchedEffect(state.errorMessage) {
        state.errorMessage?.let { msg ->
            snackbarHostState.showSnackbar(msg)
            viewModel.clearError()
        }
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Box {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .clickable { calendarMenuExpanded = true }
                                .padding(horizontal = 6.dp, vertical = 4.dp)
                        ) {
                            // Calendar color dot
                            val activeCalColor = Color(EventColors.getColor(state.activeCalendar?.color ?: "sage"))
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(activeCalColor)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = state.activeCalendar?.name ?: "모아 캘린더",
                                fontSize = 17.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Icon(
                                imageVector = Icons.Default.ArrowDropDown,
                                contentDescription = "캘린더 변경",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        DropdownMenu(
                            expanded = calendarMenuExpanded,
                            onDismissRequest = { calendarMenuExpanded = false }
                        ) {
                            state.calendars.forEach { cal ->
                                val dotColor = Color(EventColors.getColor(cal.color))
                                DropdownMenuItem(
                                    leadingIcon = {
                                        Box(
                                            modifier = Modifier
                                                .size(8.dp)
                                                .clip(CircleShape)
                                                .background(dotColor)
                                        )
                                    },
                                    text = {
                                        Text(
                                            text = cal.name,
                                            fontWeight = if (cal.id == state.activeCalendar?.id) FontWeight.Bold else FontWeight.Normal
                                        )
                                    },
                                    onClick = {
                                        viewModel.selectCalendar(cal)
                                        calendarMenuExpanded = false
                                    }
                                )
                            }
                            HorizontalDivider()
                            DropdownMenuItem(
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.Add,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp),
                                        tint = MoaGreen
                                    )
                                },
                                text = { Text("+ 새 캘린더 만들기", color = MoaGreen) },
                                onClick = {
                                    calendarMenuExpanded = false
                                    viewModel.openNewCalendarDialog()
                                }
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        if (state.isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = MoaGreen
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = "새로고침",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { viewModel.openNewEventDialog() },
                containerColor = MoaGreen,
                contentColor = Color.White,
                shape = RoundedCornerShape(12.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(imageVector = Icons.Default.Add, contentDescription = "일정 추가")
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("일정 추가", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            // Month navigation & View Mode tabs (월간/주간/일간)
            MoaCalendarHeader(
                currentMonth = state.currentMonth,
                selectedDate = state.selectedDate,
                viewMode = state.viewMode,
                onViewModeChange = { mode -> viewModel.setViewMode(mode) },
                onPrev = { viewModel.prevPeriod() },
                onNext = { viewModel.nextPeriod() },
                onGoToToday = { viewModel.goToToday() }
            )

            // Calendar Grid with public holidays
            MoaCalendarGrid(
                currentMonth = state.currentMonth,
                selectedDate = state.selectedDate,
                events = state.events,
                onDateSelected = { date -> viewModel.selectDate(date) }
            )

            HorizontalDivider(
                modifier = Modifier.padding(vertical = 4.dp),
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
            )

            // Events on selected date
            EventListView(
                selectedDate = state.selectedDate,
                events = state.selectedDateEvents,
                onEventClick = { ev -> viewModel.openEditEventDialog(ev) },
                onToggleComplete = { ev -> viewModel.toggleEventComplete(ev) },
                modifier = Modifier.weight(1f)
            )
        }
    }

    // Dialogs
    if (state.isEditorOpen && state.editingEvent != null) {
        val editingEv = state.editingEvent!!
        val isNew = editingEv.title.isEmpty()
        EventEditorDialog(
            initialEvent = editingEv,
            isNew = isNew,
            onSave = { event, isNewEvent, repeatWeeks ->
                viewModel.saveEvent(event, isNewEvent, repeatWeeks)
            },
            onDelete = { event ->
                viewModel.deleteEvent(event)
            },
            onDismiss = { viewModel.closeEditor() }
        )
    }

    if (state.isNewCalendarOpen) {
        NewCalendarDialog(
            onConfirm = { name, slug -> viewModel.createCalendar(name, slug) },
            onDismiss = { viewModel.closeNewCalendarDialog() }
        )
    }
}
