package com.ilovetrains.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationPermissionTest {
    @Test fun permissionIsBlockedOnlyAfterAnUnaskableDenial() {
        assertFalse(isLocationPermissionBlocked(locationAsked = false, granted = false, shouldShowRationale = false))
        assertFalse(isLocationPermissionBlocked(locationAsked = true, granted = true, shouldShowRationale = false))
        assertFalse(isLocationPermissionBlocked(locationAsked = true, granted = false, shouldShowRationale = true))
        assertTrue(isLocationPermissionBlocked(locationAsked = true, granted = false, shouldShowRationale = false))
    }
}
