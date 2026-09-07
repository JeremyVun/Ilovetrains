package com.ilovetrains.app
import org.junit.Assert.*
import org.junit.Test

/** Audit probes assert CURRENT defects, not desired product behavior. */
class AuditClaimsTest {
    private fun connection(now: Long) = ScheduledConnection(
        "source", "trip", "20260907", 1, 2, "A-stop", "B-stop", "A", "B",
        Station("A", "Alpha"), Station("B", "Bravo"), now+600000, now+1140000,
        0, 0, "1", "2", "T1", "train", "Charlie")
    private fun snapshot(header: Long, expiry: Long, delay: Int = 60, stops: String = "") = """
      {"schemaVersion":1,"source":"source","headerTimestamp":$header,"expiresAt":$expiry,
       "updates":[{"tripId":"trip","serviceDate":"20260907","status":"scheduled",
       "delaySeconds":$delay,"stopUpdates":[$stops]}]}
    """
    @Test fun A1_skippedIntermediateStopRemovesValidThroughRoute() {
        val now=System.currentTimeMillis(); val first=connection(now)
        val second=first.copy(fromSequence=2,toSequence=3,fromStopId="B-stop",toStopId="C-stop",
            fromStationId="B",toStationId="C",fromStation=first.toStation,toStation=Station("C","Charlie"),
            departure=now+1200000,arrival=now+1800000)
        val connections=listOf(first,second); val router=OfflineRouter()
        assertEquals(1,router.route(first.fromStation!!,second.toStation!!,now,connections,6).size)
        val rt=OfflineRealtime()
        assertTrue(rt.accept(snapshot(now,now+90000,stops="""{"stopId":"B-stop","stopSequence":2,"scheduleRelationship":"skipped"}"""),"source",now))
        val overlaid=rt.overlay(connections) { _,_->null }
        assertTrue(overlaid.all { it.cancelled })
        assertTrue(router.route(first.fromStation!!,second.toStation!!,now,overlaid,6).isEmpty())
    }
    @Test fun A2_olderSnapshotReplacesNewerSnapshot() {
        val now=System.currentTimeMillis(); val rt=OfflineRealtime(); val c=connection(now)
        assertTrue(rt.accept(snapshot(now,now+90000,300),"source",now))
        assertTrue(rt.accept(snapshot(now-10000,now+80000,60),"source",now))
        assertEquals(c.departure+60000,rt.overlay(listOf(c)) { _,_->null }.single().estimatedDeparture)
    }
    @Test fun A3_oldHeaderCanClaimLongerFreshnessAndUnknownStopRelationshipIsAccepted() {
        val now=System.currentTimeMillis(); val rt=OfflineRealtime()
        assertTrue(rt.accept(snapshot(now-3600000,now+3600000,stops="""{"stopId":"A-stop","stopSequence":1,"scheduleRelationship":"not-a-valid-value"}"""),"source",now))
        assertTrue(rt.hasFreshData())
    }
    @Test fun B1_missingDestinationCoordinatesStillInferTravel() {
        val now=System.currentTimeMillis(); val from=Station("A","Rhodes",-33.8308,151.0879)
        val to=Station("B","Uncoordinated destination"); val trip=SavedTrip("a",from,to)
        val j=Journey(listOf(Leg("T9","train","Destination",from,to,now-300000,now+1200000)))
        val board=BoardData(from,to,listOf(j),now)
        val data=UserData(trips=listOf(trip),lastAnswer=LastAnswer("a",false,now-400000,from.id,board,j))
        assertNotNull(inferredFocus(data,Fix(-33.85,151.13,now),now))
    }
    @Test fun B9_localRefreshTurnsServerStaleBoardOffline() {
        val now=System.currentTimeMillis(); val c=connection(now)
        val j=Journey(listOf(Leg("T1","train","Bravo",c.fromStation!!,c.toStation!!,c.departure,c.arrival)))
        val previous=BoardData(c.fromStation!!,c.toStation!!,listOf(j),now,serverStale=true)
        val local=previous.copy(serverStale=false,offline=true,generatedAt=now-3600000)
        assertFalse(previous.offline)
        assertTrue(mergeBoardResults(previous,local,null,now)!!.offline)
    }
}
