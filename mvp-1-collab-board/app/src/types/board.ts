export type BoardObjectKind = 'stickyNote' | 'shape'
export type ShapeKind = 'rectangle'

export type Point = {
  x: number
  y: number
}

export type Size = {
  width: number
  height: number
}

type BoardObjectBase = {
  id: string
  boardId: string
  type: BoardObjectKind
  position: Point
  size: Size
  zIndex: number
  createdBy: string
  createdAt: number
  updatedBy: string
  updatedAt: number
  version: number
  deleted?: boolean
}

export type StickyNoteObject = BoardObjectBase & {
  type: 'stickyNote'
  text: string
  color: string
}

export type ShapeObject = BoardObjectBase & {
  type: 'shape'
  shapeType: ShapeKind
  color: string
}

export type BoardObject = StickyNoteObject | ShapeObject

export type CursorPresence = {
  boardId: string
  userId: string
  displayName: string
  color: string
  x: number
  y: number
  lastSeen: number
  connectionId: string
}
