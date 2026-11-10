package com.example.moacalendar.model

import kotlinx.serialization.Serializable

@Serializable
data class CalendarItem(
    val id: String,
    val name: String,
    val owner: String = "",
    val slug: String = "",
    val color: String = "sage",
    val role: String = "owner"
)

@Serializable
data class CalendarEvent(
    val id: String,
    val calendar_id: String,
    val title: String,
    val start: String, // e.g. "2026-10-14T10:00"
    val end: String,   // e.g. "2026-10-14T11:00"
    val color: String = "sage",
    val notes: String = "",
    val category: String = "",
    val all_day: Boolean = false,
    val is_todo: Boolean = false,
    val completed: Boolean = false,
    val reminder_enabled: Boolean = false,
    val reminder_minutes: Int = 10,
    val is_dday: Boolean = false,
    val is_cancelled: Boolean = false,
    val version: Int = 1
)

@Serializable
data class UserProfile(
    val id: String,
    val name: String
)

@Serializable
data class MeResponse(
    val user: UserProfile? = null,
    val demo: Boolean = false
)

object EventColors {
    // Web과 100% 동일한 12색 테마 팔레트
    val PALETTE = listOf(
        EventColor("sage", "초록색", 0xFF368A4C, 0xFFE2F2E5, 0xFF1E5E2E),
        EventColor("blue", "파란색", 0xFF2B7FFF, 0xFFE1EFFE, 0xFF165296),
        EventColor("peach", "살구색", 0xFFF97316, 0xFFFFEEDB, 0xFF9C4815),
        EventColor("lavender", "보라색", 0xFFA855F7, 0xFFF3E8FF, 0xFF6B2897),
        EventColor("coral", "빨간색", 0xFFEF4444, 0xFFFEE2E2, 0xFF991B1B),
        EventColor("rose", "분홍색", 0xFFEC4899, 0xFFFCE7F3, 0xFF9D174D),
        EventColor("yellow", "노란색", 0xFFEAB308, 0xFFFEF9C3, 0xFF854D0E),
        EventColor("teal", "민트색", 0xFF14B8A6, 0xFFCCFBF1, 0xFF115E59),
        EventColor("orange", "주황색", 0xFFEA580C, 0xFFFFEDD5, 0xFF9A3412),
        EventColor("cyan", "하늘색", 0xFF0284C7, 0xFFE0F2FE, 0xFF075985),
        EventColor("indigo", "남색", 0xFF6366F1, 0xFFE0E7FF, 0xFF3730A3),
        EventColor("slate", "회색", 0xFF64748B, 0xFFF1F5F9, 0xFF334155)
    )

    fun getColor(key: String): Long {
        return PALETTE.firstOrNull { it.key == key }?.primaryHex ?: 0xFF368A4C
    }

    fun getBgColor(key: String): Long {
        return PALETTE.firstOrNull { it.key == key }?.bgHex ?: 0xFFE2F2E5
    }

    fun getTextColor(key: String): Long {
        return PALETTE.firstOrNull { it.key == key }?.textHex ?: 0xFF1E5E2E
    }
}

data class EventColor(
    val key: String,
    val name: String,
    val primaryHex: Long,
    val bgHex: Long,
    val textHex: Long
)
