import { Badge } from './Badge'

// Full Day (green) / Half Day (purple) — used consistently everywhere a
// Daily-mode entry's day type is shown (Admin Time & Attendance, Admin
// Reports, Employee Days, Employee Pay), so the color/label pairing can't
// drift between screens. Callers pass the already-translated label.
export function DayTypeBadge({ fullDay, label }: { fullDay: boolean; label: string }) {
  return <Badge variant={fullDay ? 'green' : 'purple'}>{label}</Badge>
}
