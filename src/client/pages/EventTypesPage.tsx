import React, { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  Code2,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Plus,
  ShieldAlert,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  LOCATION_LABELS,
  type AvailabilitySchedule,
  type CustomQuestion,
  type EventType,
  type HostProfile,
  type LocationType,
} from '../../shared/types';
import { slugify } from '../../shared/scheduling';
import { api } from '../lib/api';

interface EventTypesPageProps {
  profile: HostProfile;
  navigate: (path: string) => void;
}

const COLORS = ['#111827', '#2563eb', '#059669', '#ea580c', '#7c3aed', '#db2777'];

export const EventTypesPage: React.FC<EventTypesPageProps> = ({ profile, navigate }) => {
  const [events, setEvents] = useState<EventType[]>([]);
  const [schedules, setSchedules] = useState<AvailabilitySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [embedEvent, setEmbedEvent] = useState<EventType | null>(null);
  const [editing, setEditing] = useState<Partial<EventType> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showWelcome, setShowWelcome] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [evRes, schRes] = await Promise.all([api.listEventTypes(), api.listSchedules()]);
      setEvents(evRes.eventTypes);
      setSchedules(schRes.schedules);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const copyLink = (et: EventType) => {
    const url = `${window.location.origin}/${profile.username}/${et.slug}`;
    navigator.clipboard?.writeText(url);
    setCopiedId(et.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const openNew = () => {
    setError('');
    setEditing({
      title: '',
      slug: '',
      description: '',
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 5,
      minimumNoticeMinutes: 60,
      maxFutureDays: 60,
      slotIntervalMinutes: 30,
      locationType: 'jitsi',
      locationValue: '',
      requiresConfirmation: false,
      color: '#111827',
      hidden: false,
      scheduleId: schedules.find((s) => s.isDefault)?.id || schedules[0]?.id || '',
      customQuestions: [],
    });
  };

  const saveEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setError('');
    setSaving(true);
    try {
      if (editing.id) {
        await api.updateEventType(editing.id, editing);
      } else {
        await api.createEventType(editing);
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save event type.');
    } finally {
      setSaving(false);
    }
  };

  const toggleHidden = async (et: EventType) => {
    await api.updateEventType(et.id, { hidden: !et.hidden });
    await load();
  };

  const removeEvent = async (et: EventType) => {
    if (!window.confirm(`Delete "${et.title}"? Existing bookings will stay in your history.`)) return;
    await api.deleteEventType(et.id);
    await load();
  };

  const addQuestion = () => {
    if (!editing) return;
    const next: CustomQuestion = {
      id: `q_${Math.random().toString(36).slice(2, 8)}`,
      label: '',
      type: 'text',
      required: false,
      placeholder: '',
    };
    setEditing({ ...editing, customQuestions: [...(editing.customQuestions || []), next] });
  };

  const updateQuestion = (qid: string, patch: Partial<CustomQuestion>) => {
    if (!editing) return;
    setEditing({
      ...editing,
      customQuestions: (editing.customQuestions || []).map((q) =>
        q.id === qid ? { ...q, ...patch } : q,
      ),
    });
  };

  const removeQuestion = (qid: string) => {
    if (!editing) return;
    setEditing({
      ...editing,
      customQuestions: (editing.customQuestions || []).filter((q) => q.id !== qid),
    });
  };

  return (
    <div className="space-y-6">
      {showWelcome && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50/70 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-gray-900">
              Your Cloudflare Workers scheduling app is ready
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              EdgeCal replaces Postgres, Redis, and Docker with SQLite Durable Objects. Try booking a test meeting below, customize your hours, or follow the 3-step guide to deploy it to your Cloudflare account.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                navigate(events[0] ? `/${profile.username}/${events[0].slug}` : `/${profile.username}`)
              }
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 transition"
            >
              Try Booking Flow
            </button>
            <button
              type="button"
              onClick={() => navigate('/deploy')}
              className="rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-xs font-medium text-orange-900 hover:bg-orange-100/60 transition"
            >
              3-Step Deploy Guide
            </button>
            <button
              type="button"
              onClick={() => setShowWelcome(false)}
              aria-label="Dismiss welcome banner"
              className="rounded-lg p-1 text-gray-400 hover:bg-orange-100 hover:text-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">Event Types</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Create shareable booking links backed by your host Durable Object.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition"
        >
          <Plus className="h-4 w-4" />
          New Event Type
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Loading event types...
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center space-y-3">
          <p className="text-sm font-medium text-gray-900">No event types yet</p>
          <p className="text-xs text-gray-500">
            Create your first meeting type to start accepting bookings at /{profile.username}.
          </p>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-800"
          >
            <Plus className="h-3.5 w-3.5" /> Create Event Type
          </button>
        </div>
      ) : (
        <div className="divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-xs">
          {events.map((et) => (
            <div
              key={et.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 hover:bg-gray-50/70 transition"
            >
              <div className="min-w-0 flex items-start gap-3">
                <span
                  className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: et.color || '#111827' }}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{et.title}</span>
                    <span className="text-xs font-mono text-gray-500">
                      /{profile.username}/{et.slug}
                    </span>
                    {et.hidden && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                        Hidden
                      </span>
                    )}
                    {et.requiresConfirmation && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                        <ShieldAlert className="h-3 w-3" /> Approval required
                      </span>
                    )}
                  </div>
                  {et.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{et.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-600">
                    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 font-medium">
                      <Clock className="h-3 w-3" /> {et.durationMinutes}m
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5">
                      <Video className="h-3 w-3" /> {LOCATION_LABELS[et.locationType]}
                    </span>
                    {(et.bufferBeforeMinutes > 0 || et.bufferAfterMinutes > 0) && (
                      <span className="text-[11px] text-gray-400">
                        Buffers: {et.bufferBeforeMinutes}m / {et.bufferAfterMinutes}m
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => navigate(`/${profile.username}/${et.slug}`)}
                  title="Preview booking page"
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Preview</span>
                </button>
                <button
                  type="button"
                  onClick={() => copyLink(et)}
                  title="Copy link"
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  {copiedId === et.id ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span className="hidden md:inline">Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setEmbedEvent(et)}
                  title="Embed snippet"
                  className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-100"
                >
                  <Code2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleHidden(et)}
                  title={et.hidden ? 'Make public' : 'Hide from public page'}
                  className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-100"
                >
                  {et.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setEditing({ ...et });
                  }}
                  title="Edit"
                  className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-100"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeEvent(et)}
                  title="Delete"
                  className="rounded-lg border border-gray-200 bg-white p-1.5 text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Embed Code Modal */}
      {embedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                Embed "{embedEvent.title}"
              </h2>
              <button
                type="button"
                onClick={() => setEmbedEvent(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Paste this iframe into any website, Notion embed, or landing page.
            </p>
            <pre className="overflow-x-auto rounded-xl bg-gray-900 p-4 text-xs text-gray-100 font-mono">
{`<iframe
  src="${window.location.origin}/${profile.username}/${embedEvent.slug}?embed=1"
  style="width:100%;min-height:680px;border:1px solid #e5e7eb;border-radius:12px;"
  loading="lazy"
  title="${embedEvent.title}"
></iframe>`}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(
                    `<iframe src="${window.location.origin}/${profile.username}/${embedEvent.slug}?embed=1" style="width:100%;min-height:680px;border:1px solid #e5e7eb;border-radius:12px;" loading="lazy" title="${embedEvent.title}"></iframe>`,
                  );
                }}
                className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-800"
              >
                Copy HTML Snippet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event Type Editor Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white p-5 sm:p-6 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                {editing.id ? 'Edit Event Type' : 'Create Event Type'}
              </h2>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={saveEditor} className="space-y-4 pt-4">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
                  <input
                    type="text"
                    required
                    value={editing.title || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditing((prev) => ({
                        ...prev,
                        title: val,
                        slug: prev?.id ? prev.slug : slugify(val),
                      }));
                    }}
                    placeholder="30 Min Discovery Call"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">URL Slug</label>
                  <div className="flex items-center rounded-lg border border-gray-300 overflow-hidden">
                    <span className="bg-gray-50 px-2.5 py-2 text-xs text-gray-500 border-r border-gray-200">
                      /{profile.username}/
                    </span>
                    <input
                      type="text"
                      required
                      value={editing.slug || ''}
                      onChange={(e) => setEditing({ ...editing, slug: slugify(e.target.value) })}
                      placeholder="discovery-call"
                      className="flex-1 px-2.5 py-2 text-sm outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={editing.description || ''}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Tell attendees what this meeting is about..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Duration (min)</label>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    value={editing.durationMinutes ?? 30}
                    onChange={(e) =>
                      setEditing({ ...editing, durationMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Slot Step (min)</label>
                  <input
                    type="number"
                    min={5}
                    max={240}
                    value={editing.slotIntervalMinutes ?? 30}
                    onChange={(e) =>
                      setEditing({ ...editing, slotIntervalMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Buffer Before</label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={editing.bufferBeforeMinutes ?? 0}
                    onChange={(e) =>
                      setEditing({ ...editing, bufferBeforeMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Buffer After</label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={editing.bufferAfterMinutes ?? 0}
                    onChange={(e) =>
                      setEditing({ ...editing, bufferAfterMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Min Notice (minutes)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editing.minimumNoticeMinutes ?? 60}
                    onChange={(e) =>
                      setEditing({ ...editing, minimumNoticeMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Booking Window (days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={editing.maxFutureDays ?? 60}
                    onChange={(e) =>
                      setEditing({ ...editing, maxFutureDays: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Schedule</label>
                  <select
                    value={editing.scheduleId || ''}
                    onChange={(e) => setEditing({ ...editing, scheduleId: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                  >
                    {schedules.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.timezone})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Location</label>
                  <select
                    value={editing.locationType || 'jitsi'}
                    onChange={(e) =>
                      setEditing({ ...editing, locationType: e.target.value as LocationType })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                  >
                    {Object.entries(LOCATION_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Meeting URL / Address / Phone (optional)
                  </label>
                  <input
                    type="text"
                    value={editing.locationValue || ''}
                    onChange={(e) => setEditing({ ...editing, locationValue: e.target.value })}
                    placeholder={
                      editing.locationType === 'jitsi'
                        ? 'Auto-generated per booking'
                        : 'https://... or street address'
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editing.requiresConfirmation)}
                    onChange={(e) =>
                      setEditing({ ...editing, requiresConfirmation: e.target.checked })
                    }
                    className="h-4 w-4 accent-gray-900"
                  />
                  Require host confirmation before locking booking
                </label>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 mr-1">Color:</span>
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditing({ ...editing, color: c })}
                      className={`h-5 w-5 rounded-full transition ${
                        editing.color === c ? 'ring-2 ring-offset-2 ring-gray-900' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Custom Booking Questions */}
              <div className="border-t border-gray-200 pt-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-900">
                    Custom Booking Questions
                  </span>
                  <button
                    type="button"
                    onClick={addQuestion}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Plus className="h-3 w-3" /> Add Question
                  </button>
                </div>

                {(editing.customQuestions || []).map((q) => (
                  <div
                    key={q.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2.5"
                  >
                    <input
                      type="text"
                      value={q.label}
                      onChange={(e) => updateQuestion(q.id, { label: e.target.value })}
                      placeholder="Question label (e.g., Company name)"
                      className="flex-1 min-w-[160px] rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                    <select
                      value={q.type}
                      onChange={(e) =>
                        updateQuestion(q.id, { type: e.target.value as CustomQuestion['type'] })
                      }
                      className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                    >
                      <option value="text">Short Text</option>
                      <option value="textarea">Long Text</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={q.required}
                        onChange={(e) => updateQuestion(q.id, { required: e.target.checked })}
                        className="accent-gray-900"
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      onClick={() => removeQuestion(q.id)}
                      className="rounded-lg p-1 text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Event Type'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
