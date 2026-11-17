package billing.limits

data class LimitRule(
    val customerId: String,
    val maxExposure: Int,
    val periodDays: Int = LimitDefaults.PERIOD_DAYS,
    val active: Boolean = true,
    val maxOpenOrders: Int = LimitDefaults.MAX_OPEN_ORDERS,
)
