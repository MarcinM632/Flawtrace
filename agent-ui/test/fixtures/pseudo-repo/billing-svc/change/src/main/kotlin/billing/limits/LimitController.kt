package billing.limits

class Forbidden : RuntimeException("forbidden")

interface Auth {
    fun canRead(customerId: String): Boolean
}

class LimitController(private val service: LimitService, private val repo: LimitRuleRepository) {
    // GET /limits/{customerId}
    fun get(customerId: String, auth: Auth): LimitRuleDto {
        val rule = repo.find(customerId) ?: throw NoSuchElementException(customerId)
        return LimitRuleMapper.toDto(rule)
    }

    // PUT /limits
    fun put(dto: LimitRuleDto): LimitRuleDto = service.save(dto)

    // GET /limits/check?customerId=&exposure=&openOrders=   (all three are required)
    fun check(customerId: String, exposure: Int, openOrders: Int): CheckResult =
        service.check(customerId, exposure, openOrders)
}
