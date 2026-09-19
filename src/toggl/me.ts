import type { TogglClient } from '../http/client.ts'
import type { WireMe } from './wire-types.ts'

export async function fetchMe(client: TogglClient): Promise<WireMe> {
  const response = await client.get<WireMe>('/me')
  return response.data
}
