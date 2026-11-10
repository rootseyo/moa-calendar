package com.example.moacalendar.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.moacalendar.data.MoaRepository
import com.example.moacalendar.model.CalendarEvent
import com.example.moacalendar.model.CalendarItem
import com.example.moacalendar.model.UserProfile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.UUID

enum class CalendarViewMode {
    MONTH, WEEK, DAY
}

data class CalendarUiState(
    val currentMonth: YearMonth = YearMonth.now(),
    val selectedDate: LocalDate = LocalDate.now(),
    val viewMode: CalendarViewMode = CalendarViewMode.MONTH,
    val calendars: List<CalendarItem> = emptyList(),
    val activeCalendar: CalendarItem? = null,
    val events: List<CalendarEvent> = emptyList(),
    val selectedDateEvents: List<CalendarEvent> = emptyList(),
    val currentUser: UserProfile? = null,
    val isLoading: Boolean = false,
    val editingEvent: CalendarEvent? = null,
    val isEditorOpen: Boolean = false,
    val isNewCalendarOpen: Boolean = false,
    val errorMessage: String? = null
)

class MoaCalendarViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = MoaRepository.getInstance(application)

    private val _currentMonth = MutableStateFlow(YearMonth.now())
    private val _selectedDate = MutableStateFlow(LocalDate.now())
    private val _viewMode = MutableStateFlow(CalendarViewMode.MONTH)
    private val _isLoading = MutableStateFlow(false)
    private val _editingEvent = MutableStateFlow<CalendarEvent?>(null)
    private val _isEditorOpen = MutableStateFlow(false)
    private val _isNewCalendarOpen = MutableStateFlow(false)
    private val _errorMessage = MutableStateFlow<String?>(null)

    val uiState: StateFlow<CalendarUiState> = combine(
        _currentMonth,
        _selectedDate,
        _viewMode,
        repository.calendars,
        repository.activeCalendar,
        repository.events,
        repository.currentUser,
        _isLoading,
        _editingEvent,
        _isEditorOpen,
        _isNewCalendarOpen,
        _errorMessage
    ) { params ->
        val currentMonth = params[0] as YearMonth
        val selectedDate = params[1] as LocalDate
        val viewMode = params[2] as CalendarViewMode
        @Suppress("UNCHECKED_CAST")
        val calendars = params[3] as List<CalendarItem>
        val activeCalendar = params[4] as CalendarItem?
        @Suppress("UNCHECKED_CAST")
        val events = params[5] as List<CalendarEvent>
        val currentUser = params[6] as UserProfile?
        val isLoading = params[7] as Boolean
        val editingEvent = params[8] as CalendarEvent?
        val isEditorOpen = params[9] as Boolean
        val isNewCalendarOpen = params[10] as Boolean
        val errorMessage = params[11] as String?

        val selectedDateStr = selectedDate.format(DateTimeFormatter.ISO_LOCAL_DATE)
        val selectedEvents = events.filter { ev ->
            val start = ev.start.substringBefore("T")
            val end = ev.end.substringBefore("T")
            start <= selectedDateStr && selectedDateStr <= end
        }.sortedBy { it.start }

        CalendarUiState(
            currentMonth = currentMonth,
            selectedDate = selectedDate,
            viewMode = viewMode,
            calendars = calendars,
            activeCalendar = activeCalendar,
            events = events,
            selectedDateEvents = selectedEvents,
            currentUser = currentUser,
            isLoading = isLoading,
            editingEvent = editingEvent,
            isEditorOpen = isEditorOpen,
            isNewCalendarOpen = isNewCalendarOpen,
            errorMessage = errorMessage
        )
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5000),
        CalendarUiState()
    )

    init {
        refresh()
    }

    fun setViewMode(mode: CalendarViewMode) {
        _viewMode.value = mode
    }

    fun selectDate(date: LocalDate) {
        _selectedDate.value = date
        if (YearMonth.from(date) != _currentMonth.value) {
            _currentMonth.value = YearMonth.from(date)
        }
    }

    fun prevPeriod() {
        when (_viewMode.value) {
            CalendarViewMode.MONTH -> {
                _currentMonth.value = _currentMonth.value.minusMonths(1)
            }
            CalendarViewMode.WEEK -> {
                _selectedDate.value = _selectedDate.value.minusWeeks(1)
                _currentMonth.value = YearMonth.from(_selectedDate.value)
            }
            CalendarViewMode.DAY -> {
                _selectedDate.value = _selectedDate.value.minusDays(1)
                _currentMonth.value = YearMonth.from(_selectedDate.value)
            }
        }
    }

    fun nextPeriod() {
        when (_viewMode.value) {
            CalendarViewMode.MONTH -> {
                _currentMonth.value = _currentMonth.value.plusMonths(1)
            }
            CalendarViewMode.WEEK -> {
                _selectedDate.value = _selectedDate.value.plusWeeks(1)
                _currentMonth.value = YearMonth.from(_selectedDate.value)
            }
            CalendarViewMode.DAY -> {
                _selectedDate.value = _selectedDate.value.plusDays(1)
                _currentMonth.value = YearMonth.from(_selectedDate.value)
            }
        }
    }

    fun goToToday() {
        val today = LocalDate.now()
        _currentMonth.value = YearMonth.now()
        _selectedDate.value = today
    }

    fun selectCalendar(cal: CalendarItem) {
        repository.selectCalendar(cal)
    }

    fun refresh() {
        viewModelScope.launch {
            _isLoading.value = true
            _errorMessage.value = null
            val res = repository.refreshAll()
            if (res.isFailure) {
                _errorMessage.value = res.exceptionOrNull()?.message
            }
            _isLoading.value = false
        }
    }

    fun openNewEventDialog() {
        val dateStr = _selectedDate.value.format(DateTimeFormatter.ISO_LOCAL_DATE)
        _editingEvent.value = CalendarEvent(
            id = UUID.randomUUID().toString(),
            calendar_id = repository.activeCalendar.value?.id ?: "",
            title = "",
            start = "${dateStr}T10:00",
            end = "${dateStr}T11:00",
            color = "sage"
        )
        _isEditorOpen.value = true
    }

    fun openEditEventDialog(event: CalendarEvent) {
        _editingEvent.value = event
        _isEditorOpen.value = true
    }

    fun closeEditor() {
        _isEditorOpen.value = false
        _editingEvent.value = null
    }

    fun saveEvent(event: CalendarEvent, isNew: Boolean, repeatWeeks: Int = 1) {
        viewModelScope.launch {
            if (isNew) {
                repository.addEvent(event, repeatWeeks)
            } else {
                repository.updateEvent(event)
            }
            closeEditor()
        }
    }

    fun toggleEventComplete(event: CalendarEvent) {
        viewModelScope.launch {
            val updated = event.copy(completed = !event.completed)
            repository.updateEvent(updated)
        }
    }

    fun deleteEvent(event: CalendarEvent) {
        viewModelScope.launch {
            repository.deleteEvent(event)
            closeEditor()
        }
    }

    fun openNewCalendarDialog() {
        _isNewCalendarOpen.value = true
    }

    fun closeNewCalendarDialog() {
        _isNewCalendarOpen.value = false
    }

    fun createCalendar(name: String, slug: String? = null) {
        viewModelScope.launch {
            repository.addCalendar(name, slug)
            closeNewCalendarDialog()
        }
    }

    fun clearError() {
        _errorMessage.value = null
    }
}
