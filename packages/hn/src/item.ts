import type { ItemResponse } from '@yahn/schema'
import { getCommentSource } from './tree/index.ts'

export async function getItem(id: number): Promise<ItemResponse> {
  return getCommentSource().loadItem(id)
}
