package billing.limits

/** Defaults for a customer limit rule. Shared by rules and by invoicing. */
object LimitDefaults {
    const val PERIOD_DAYS = 7
    const val MAX_EXPOSURE = 1000
    const val MAX_OPEN_ORDERS = 5
}
