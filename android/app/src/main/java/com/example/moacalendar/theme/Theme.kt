package com.example.moacalendar.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val MoaLightColorScheme = lightColorScheme(
    primary = MoaGreen,
    onPrimary = Color.White,
    primaryContainer = MoaGreenLight,
    onPrimaryContainer = MoaGreenDark,
    secondary = MoaGreen,
    onSecondary = Color.White,
    background = MoaBackground,
    onBackground = MoaText,
    surface = MoaSurface,
    onSurface = MoaText,
    surfaceVariant = Color(0xFFEFF3EB),
    onSurfaceVariant = MoaTextMuted,
    outline = MoaBorder,
    outlineVariant = Color(0xFFD6DEC9)
)

@Composable
fun MoaCalendarTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = MoaLightColorScheme,
        typography = Typography,
        content = content
    )
}
