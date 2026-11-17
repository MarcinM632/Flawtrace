package orders

class OrderService(private val billing: BillingClient, private val cache: LimitCache) {
    private val open = HashMap<String, Int>()

    fun create(customerId: String, amount: Int): Boolean {
        if (!billing.mayOrder(customerId, amount)) return false
        open.merge(customerId, 1, Int::plus)
        return true
    }

    fun openOrders(customerId: String): Int = open[customerId] ?: 0

    fun cachedLimit(customerId: String): Int? = cache.limitOf(customerId)
}
