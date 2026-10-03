package com.ilovetrains.app

import android.content.Context
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/** The first [dayOfWeek] after the bundled timetable's first day that keeps one UTC offset throughout. */
internal fun bundledDay(context: Context, dayOfWeek: DayOfWeek): LocalDate {
    val manifest = JSONObject(context.assets.open("timetable-manifest.json").bufferedReader().use { it.readText() })
    var day = LocalDate.parse(manifest.getString("serviceDateFrom"), DateTimeFormatter.BASIC_ISO_DATE).plusDays(1)
    while (day.dayOfWeek != dayOfWeek || day.atStartOfDay(Sydney).offset != day.plusDays(1).atStartOfDay(Sydney).offset) {
        day = day.plusDays(1)
    }
    return day
}
