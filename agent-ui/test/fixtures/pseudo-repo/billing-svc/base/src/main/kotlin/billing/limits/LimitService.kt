package billing.limits

interface LimitRuleRepository {
    fun find(customerId: String): LimitRule?
    fun save(rule: LimitRule)
}

interface EventPublisher {
    fun publish(topic: String, payload: Map<String, Any?>)
}

data class CheckResult(val allowed: Boolean, val reason: String? = null) {
    companion object {
        fun allowed() = CheckResult(true)
        fun rejected(reason: String) = CheckResult(false, reason)
    }
}

class LimitService(
    private val repo: LimitRuleRepository,
    private val events: EventPublisher,
) {
    fun save(dto: LimitRuleDto): LimitRuleDto {
        val rule = LimitRuleMapper.toEntity(dto)
        LimitRuleValidator.validate(rule)
        repo.save(rule)
        events.publish(
            "limit.changed",
            mapOf("customerId" to rule.customerId, "customerLimit" to rule.maxExposure),
        )
        return LimitRuleMapper.toDto(rule)
    }

    fun check(customerId: String, exposure: Int): CheckResult {
        val rule = repo.find(customerId) ?: return CheckResult.allowed()
        if (!rule.active) return CheckResult.allowed()
        return if (exposure > rule.maxExposure) CheckResult.rejected("exposure over limit") else CheckResult.allowed()
    }
}
