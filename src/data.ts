export type Stage = 'Ý tưởng' | 'Kịch bản' | 'Sản xuất' | 'Kiểm duyệt' | 'Đã lên lịch'

export type ShortItem = {
  id: number
  title: string
  channel: string
  stage: Stage
  date: string
  time?: string
  score?: number
  owner: string
  color: string
  warning?: string
}

export const stages: Stage[] = ['Ý tưởng', 'Kịch bản', 'Sản xuất', 'Kiểm duyệt', 'Đã lên lịch']

export const initialShorts: ShortItem[] = []
