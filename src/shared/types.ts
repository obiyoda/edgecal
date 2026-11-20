export type LocationType =
  | 'jitsi'
  | 'daily'
  | 'zoom'
  | 'google_meet'
  | 'custom_link'
  | 'in_person'
  | 'phone';

export type BookingStatus = 'confirmed' | 'pending' | 'cancelled';

export type TimeFormat = '12h' | '24h';

export interface HostProfile {
  id: string;
  username: string;
  name: string;
  email: string;
  bio: string;
  timezone: string;
  timeFormat: TimeFormat;
  brandColor: string;
  avatarColor: string;
  createdAt: string;
}

export interface CustomQuestion {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox';
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface EventType {
  id: string;
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  maxFutureDays: number;
  slotIntervalMinutes: number;
  locationType: LocationType;
  locationValue: string;
  requiresConfirmation: boolean;
  color: string;
  hidden: boolean;
  scheduleId: string;
  customQuestions: CustomQuestion[];
  createdAt: string;
}

export interface TimeRange {
  start: string; // "HH:MM" 24-hour
  end: string;   // "HH:MM" 24-hour
}

// 0 = Sunday, 1 = Monday, ... 6 = Saturday
export type WeeklyHours = Record<number, TimeRange[]>;

export interface DateOverride {
  id: string;
  scheduleId: string;
  dateYmd: string; // "YYYY-MM-DD"
  unavailable: boolean;
  ranges: TimeRange[];
  label?: string;
}

export interface AvailabilitySchedule {
  id: string;
  name: string;
  timezone: string;
  isDefault: boolean;
  weeklyHours: WeeklyHours;
  dateOverrides: DateOverride[];
  createdAt: string;
}

export interface Booking {
  id: string;
  uid: string;
  eventTypeId: string;
  eventTypeTitle: string;
  eventTypeSlug: string;
  title: string;
  startUtc: string; // ISO-8601 UTC
  endUtc: string;   // ISO-8601 UTC
  durationMinutes: number;
  status: BookingStatus;
  attendeeName: string;
  attendeeEmail: string;
  attendeeTimezone: string;
  attendeeNotes: string;
  customAnswers: Record<string, string>;
  locationType: LocationType;
  locationDisplay: string;
  meetingUrl: string;
  cancelToken: string;
  rescheduleToken: string;
  cancellationReason?: string;
  reminder24hSentAt?: string | null;
  reminder1hSentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PublicBooking = Omit<Booking, 'cancelToken' | 'rescheduleToken'>;

export interface PublicBookingResponse {
  booking: PublicBooking;
  host: Omit<HostProfile, 'email'>;
  canCancel: boolean;
  canReschedule: boolean;
}

export type WebhookEventType =
  | 'BOOKING_CREATED'
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_RESCHEDULED'
  | 'BOOKING_REMINDER';

export interface WebhookConfig {
  id: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  active: boolean;
  lastStatus?: number | null;
  lastTriggeredAt?: string | null;
  createdAt: string;
}

export type IntegrationProvider =
  | 'ics_feed'
  | 'cloudflare_email'
  | 'daily_video'
  | 'zoom_link'
  | 'google_meet';

export interface IntegrationConfig {
  provider: IntegrationProvider;
  enabled: boolean;
  config: Record<string, string>;
  updatedAt: string;
}

export interface BlockedInterval {
  id: string;
  source: string;
  title: string;
  startUtc: string;
  endUtc: string;
}

export interface ActivityLogEntry {
  id: string;
  kind: 'booking' | 'alarm' | 'webhook' | 'sync' | 'system';
  message: string;
  createdAt: string;
}

export interface DOStatusInfo {
  runtime: 'cloudflare-durable-object' | 'local-preview';
  durableObjectClass: string;
  hostId: string;
  nextAlarmUtc: string | null;
  counts: {
    eventTypes: number;
    schedules: number;
    bookingsTotal: number;
    bookingsUpcoming: number;
    webhooks: number;
    blockedSlots: number;
  };
  recentActivity: ActivityLogEntry[];
}

export interface TimeSlot {
  startUtc: string;
  endUtc: string;
}

export interface PublicHostBundle {
  profile: Omit<HostProfile, 'email'>;
  eventTypes: EventType[];
}

export interface SetupStatusResponse {
  setupCompleted: boolean;
  allowSignups: boolean;
  appName: string;
  runtime: 'cloudflare-durable-object' | 'local-preview';
  defaultUsername: string | null;
}

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  0: [],
  1: [{ start: '09:00', end: '17:00' }],
  2: [{ start: '09:00', end: '17:00' }],
  3: [{ start: '09:00', end: '17:00' }],
  4: [{ start: '09:00', end: '17:00' }],
  5: [{ start: '09:00', end: '17:00' }],
  6: [],
};

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const DAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const LOCATION_LABELS: Record<LocationType, string> = {
  jitsi: 'Instant Video Room (Jitsi)',
  daily: 'Daily.co Video',
  zoom: 'Zoom Meeting',
  google_meet: 'Google Meet',
  custom_link: 'Custom Video Link',
  in_person: 'In Person',
  phone: 'Phone Call',
};
