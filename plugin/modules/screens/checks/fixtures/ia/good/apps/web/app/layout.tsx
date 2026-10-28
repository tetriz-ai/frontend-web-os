import Link from 'next/link';

export default function L({ children }) {
  return <body><nav><Link href="/settings">Settings</Link><Link href="/members">Members</Link></nav>{children}</body>;
}
