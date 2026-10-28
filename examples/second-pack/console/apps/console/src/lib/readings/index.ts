/** Port readings, formatted one way everywhere: metres to one decimal, times in port time, 24-hour. */
const metres = new Intl.NumberFormat('en-GB', { style: 'unit', unit: 'meter', maximumFractionDigits: 1 });
const portTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Amsterdam' });

export const formatMetres = (m: number) => metres.format(m);
export const formatPortTime = (iso: string) => portTime.format(new Date(iso));
