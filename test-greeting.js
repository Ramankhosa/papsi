// Simple test to check greeting logic
function getTimeSegment() {
  const now = new Date();
  const hour = now.getHours();

  if (hour >= 5 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 12) return 'morning'; // Late morning still morning
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening';
  if (hour >= 20 && hour < 24) return 'evening';
  return 'evening'; // Default to evening for late night
}

function getDayOfWeek() {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const today = new Date().getDay();
  return days[today];
}

function getCurrentTimeString() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
}

console.log('Current time:', getCurrentTimeString());
console.log('Time segment:', getTimeSegment());
console.log('Day of week:', getDayOfWeek());
