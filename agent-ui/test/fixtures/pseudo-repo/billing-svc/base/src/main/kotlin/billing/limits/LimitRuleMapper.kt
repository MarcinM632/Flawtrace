package billing.limits

data class LimitRuleDto(
    val customerId: String,
    val maxExposure: Int,
    val periodDays: Int,
    val active: Boolean,
)

object LimitRuleMapper {
    fun toDto(r: LimitRule) = LimitRuleDto(r.customerId, r.maxExposure, r.periodDays, r.active)

    fun toEntity(d: LimitRuleDto) = LimitRule(d.customerId, d.maxExposure, d.periodDays, d.active)
}
