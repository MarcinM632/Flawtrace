package billing.limits

object LimitRuleValidator {
    fun validate(rule: LimitRule) {
        require(rule.customerId.isNotBlank()) { "customerId is required" }
        require(rule.maxExposure in 1..100000) { "maxExposure must be 1..100000" }
        require(rule.periodDays in 1..365) { "periodDays must be 1..365" }
        require(rule.maxOpenOrders in 1..1000) { "maxOpenOrders must be 1..1000" }
    }
}
