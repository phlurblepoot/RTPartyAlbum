import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { adminApi, ApiError } from '../api';
import { useDebouncedCallback } from './useDebouncedCallback';
import { ThemeSelect } from './ThemeSelect';
import type {
  EventDetail,
  MotionConfig,
  MotionStyle,
  EnterAnimation,
  LeaveAnimation,
} from '@rtpa/shared';

interface Info {
  label: string;
  hint: string;
}

const MOTION_INFO: Record<MotionStyle, Info> = {
  drift: { label: 'Drift', hint: 'Gentle aimless wandering' },
  current: { label: 'Current', hint: 'Slow sideways sweep, like a stream' },
  orbit: { label: 'Orbit', hint: 'Circles around its spot (stays upright)' },
  mosaic: { label: 'Mosaic', hint: 'Tight, snappy grid-like steps' },
};
const ENTER_INFO: Record<EnterAnimation, Info> = {
  flyInEdge: { label: 'Fly in', hint: 'Slides in from the side' },
  scalePop: { label: 'Pop', hint: 'Pops in from small' },
  fadeGrow: { label: 'Fade + grow', hint: 'Fades while growing in' },
  spinIn: { label: 'Spin in', hint: 'Spins upright as it appears' },
  dropBounce: { label: 'Drop', hint: 'Drops in with a bounce' },
};
const LEAVE_INFO: Record<LeaveAnimation, Info> = {
  driftOffEdge: { label: 'Drift off', hint: 'Slides off to the side' },
  shrinkFade: { label: 'Shrink', hint: 'Shrinks and fades out' },
  spinOut: { label: 'Spin out', hint: 'Spins away' },
  slideAway: { label: 'Slide down', hint: 'Slides downward out of view' },
};

const MOTION_STYLES = Object.keys(MOTION_INFO) as MotionStyle[];
const ENTER_ANIMS = Object.keys(ENTER_INFO) as EnterAnimation[];
const LEAVE_ANIMS = Object.keys(LEAVE_INFO) as LeaveAnimation[];

/** A labelled 0–10 "how often" weight slider with a live value readout. */
function WeightRow({
  info,
  value,
  ariaLabel,
  onChange,
}: {
  info: Info;
  value: number;
  ariaLabel: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="control-row">
      <div className="control-row__head">
        <span className="control-row__name">{info.label}</span>
        <span className="control-row__value">{value === 0 ? 'off' : `${value}/10`}</span>
      </div>
      <span className="control-row__hint">{info.hint}</span>
      <input
        type="range"
        min={0}
        max={10}
        step={1}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function DisplayTab({ event }: { event: EventDetail }) {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<MotionConfig>(event.motionConfig);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const pushConfig = useDebouncedCallback((cfg: MotionConfig) => {
    setSaving(true);
    adminApi
      .setMotion(event.id, cfg)
      .then((updatedEvent) => {
        queryClient.setQueryData(['admin', 'event', event.id], updatedEvent);
        setSaveError(null);
      })
      .catch((err) =>
        setSaveError(err instanceof ApiError ? `Save failed (${err.status})` : 'Save failed'),
      )
      .finally(() => setSaving(false));
  }, 350);

  function update(next: MotionConfig) {
    setConfig(next);
    pushConfig(next);
  }

  return (
    <div className="display-tab" data-testid="display-tab">
      <div className="display-tab__header">
        <h2>Display settings</h2>
        <button
          type="button"
          onClick={() => window.open(`/e/${event.code}/display`, '_blank', 'noopener')}
        >
          Open display
        </button>
        <span className="display-tab__status" aria-live="polite">
          {saving ? 'Saving…' : 'Saved'}
        </span>
        {saveError && (
          <span role="alert" className="save-error">
            {saveError}
          </span>
        )}
      </div>
      <p className="field-hint">
        Changes save automatically and update any open display within a second or two.
      </p>

      <ThemeSelect event={event} />

      <fieldset>
        <legend>How photos move</legend>
        <span className="field-hint">
          Higher = that motion is picked more often. Set to “off” to never use it.
        </span>
        {MOTION_STYLES.map((s) => (
          <WeightRow
            key={s}
            info={MOTION_INFO[s]}
            value={config.motionWeights[s]}
            ariaLabel={`motion weight ${s}`}
            onChange={(n) =>
              update({ ...config, motionWeights: { ...config.motionWeights, [s]: n } })
            }
          />
        ))}
      </fieldset>

      <div className="control-row">
        <div className="control-row__head">
          <span className="control-row__name">Overall speed</span>
          <span className="control-row__value">{config.speed}×</span>
        </div>
        <span className="control-row__hint">How fast everything moves and animates.</span>
        <input
          type="range"
          min={0.25}
          max={3}
          step={0.25}
          value={config.speed}
          aria-label="overall speed"
          onChange={(e) => update({ ...config, speed: Number(e.target.value) })}
        />
      </div>

      <label>
        Max photos on screen at once
        <input
          type="number"
          min={1}
          max={200}
          value={config.maxOnCanvas}
          aria-label="max on canvas"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) update({ ...config, maxOnCanvas: n });
          }}
        />
      </label>

      <fieldset>
        <legend>Auto-rotate photos</legend>
        <span className="field-hint">
          When on, each photo leaves after a while so newer ones get screen time.
        </span>
        <label>
          Dwell timeout enabled
          <input
            type="checkbox"
            checked={config.dwell.enabled}
            onChange={(e) =>
              update({ ...config, dwell: { ...config.dwell, enabled: e.target.checked } })
            }
          />
        </label>
        {config.dwell.enabled && (
          <>
            <label>
              Time on screen (seconds)
              <input
                type="number"
                min={1}
                step={1}
                value={Math.round(config.dwell.durationMs / 1000)}
                aria-label="dwell duration"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isNaN(n))
                    update({ ...config, dwell: { ...config.dwell, durationMs: n * 1000 } });
                }}
              />
            </label>
            <label>
              Random variation (seconds)
              <input
                type="number"
                min={0}
                step={1}
                value={Math.round(config.dwell.varianceMs / 1000)}
                aria-label="dwell variance"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isNaN(n))
                    update({ ...config, dwell: { ...config.dwell, varianceMs: n * 1000 } });
                }}
              />
            </label>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>How photos appear</legend>
        <span className="field-hint">Higher = that entrance is picked more often.</span>
        {ENTER_ANIMS.map((a) => (
          <WeightRow
            key={a}
            info={ENTER_INFO[a]}
            value={config.enterWeights[a]}
            ariaLabel={`enter weight ${a}`}
            onChange={(n) =>
              update({ ...config, enterWeights: { ...config.enterWeights, [a]: n } })
            }
          />
        ))}
      </fieldset>

      <fieldset>
        <legend>How photos leave</legend>
        <span className="field-hint">Higher = that exit is picked more often.</span>
        {LEAVE_ANIMS.map((a) => (
          <WeightRow
            key={a}
            info={LEAVE_INFO[a]}
            value={config.leaveWeights[a]}
            ariaLabel={`leave weight ${a}`}
            onChange={(n) =>
              update({ ...config, leaveWeights: { ...config.leaveWeights, [a]: n } })
            }
          />
        ))}
      </fieldset>

      <div className="control-row">
        <div className="control-row__head">
          <span className="control-row__name">Photo size</span>
          <span className="control-row__value">{config.baseSize}px</span>
        </div>
        <span className="control-row__hint">Baseline size of each photo on the big screen.</span>
        <input
          type="range"
          min={80}
          max={800}
          step={10}
          value={config.baseSize}
          aria-label="base size"
          onChange={(e) => update({ ...config, baseSize: Number(e.target.value) })}
        />
      </div>

      <div className="control-row">
        <div className="control-row__head">
          <span className="control-row__name">Size variety</span>
          <span className="control-row__value">{Math.round(config.sizeVariance * 100)}%</span>
        </div>
        <span className="control-row__hint">How much photo sizes vary from each other.</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={config.sizeVariance}
          aria-label="size variance"
          onChange={(e) => update({ ...config, sizeVariance: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}
