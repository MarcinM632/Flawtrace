package billing.limits

/** Defaults for a customer limit rule. Shared by rules and by invoicing. */
object LimitDefaults {
    const val PERIOD_DAYS = 30
    const val MAX_EXPOSURE = 1000
}
