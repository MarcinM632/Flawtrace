package orders

/** Local copy of customer limits, refreshed by the `limit.changed` event of billing-svc. */
class LimitCache {
    private val limits = HashMap<String, Int>()

    fun onLimitChanged(payload: Map<String, Any?>) {
        val customer = payload["customerId"] as String
        val limit = payload["customerLimit"] as? Int ?: return
        limits[customer] = limit
    }

    fun limitOf(customerId: String): Int? = limits[customerId]
}
