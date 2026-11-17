package orders

interface Http {
    fun get(url: String): Map<String, Any?>
}

class BillingClient(private val http: Http, private val baseUrl: String) {
    /** Asks billing-svc whether the customer may place an order with this exposure. */
    fun mayOrder(customerId: String, exposure: Int): Boolean {
        val r = http.get("$baseUrl/limits/check?customerId=$customerId&exposure=$exposure")
        return r["allowed"] == true
    }
}
