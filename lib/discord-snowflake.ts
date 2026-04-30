const DISCORD_EPOCH = BigInt('1420070400000') // 2015-01-01T00:00:00.000Z

export function discordSnowflakeToDate(snowflake: string): Date | null {
  try {
    const id = BigInt(snowflake)
    const timestamp = Number((id >> BigInt(22)) + DISCORD_EPOCH)
    return new Date(timestamp)
  } catch {
    return null
  }
}
