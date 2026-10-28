import { permanentRedirect } from 'next/navigation';

/** The berth list's old address, from before the berths board. */
export default function BerthListPage() {
  permanentRedirect('/berths');
}
