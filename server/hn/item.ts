import type { ItemResponse } from '../../shared/schema/index.js'
import { getCommentSource } from './tree/index.js'

export async function getItem(id: number): Promise<ItemResponse> {
  return getCommentSource().loadItem(id)
}
