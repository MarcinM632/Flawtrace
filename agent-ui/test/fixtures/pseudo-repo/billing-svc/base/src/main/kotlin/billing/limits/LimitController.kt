package billing.limits

class Forbidden : RuntimeException("forbidden")

interface Auth {
    fun canRead(customerId: String): Boolean
}

class LimitController(private val service: LimitService, private val repo: LimitRuleRepository) {
    // GET /limits/{customerId}
    fun get(customerId: String, auth: Auth): LimitRuleDto {
        if (!auth.canRead(customerId)) throw Forbidden()
        val rule = repo.find(customerId) ?: throw NoSuchElementException(customerId)
        return LimitRuleMapper.toDto(rule)
    }

    // PUT /limits
    fun put(dto: LimitRuleDto): LimitRuleDto = service.save(dto)

    // GET /limits/check?customerId=&exposure=
    fun check(customerId: String, exposure: Int): CheckResult = service.check(customerId, exposure)
}
