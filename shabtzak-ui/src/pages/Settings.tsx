// shabtzak-ui/src/pages/Settings.tsx
import { useState, useEffect } from "react";
import { getPlannerWeights, savePlannerWeights, DEFAULT_WEIGHTS, type PlannerWeights } from "../api";

export default function Settings() {
  const [weights, setWeights] = useState<PlannerWeights>(DEFAULT_WEIGHTS);
  const [saveStatus, setSaveStatus] = useState<"success" | "error" | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const loaded = getPlannerWeights();
      setWeights(loaded);
    } catch (error) {
      console.error("Failed to load weights:", error);
      setWeights(DEFAULT_WEIGHTS);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleWeightChange = (key: keyof PlannerWeights, value: number) => {
    const newWeights = { ...weights, [key]: value };
    setWeights(newWeights);
    // Auto-save immediately
    try {
      savePlannerWeights(newWeights);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (error) {
      setSaveStatus("error");
    }
  };

  const handleReset = () => {
    if (confirm("Are you sure you want to reset all weights to default values?")) {
      setWeights(DEFAULT_WEIGHTS);
      try {
        savePlannerWeights(DEFAULT_WEIGHTS);
        setSaveStatus("success");
        setTimeout(() => setSaveStatus(null), 2000);
      } catch (error) {
        setSaveStatus("error");
      }
    }
  };


  const weightDescriptions: Record<keyof PlannerWeights, { label: string; description: string }> = {
    recent_gap_penalty_per_hour_missing: {
      label: "Short Rest Penalty (per hour missing)",
      description: "Higher values penalize soldiers who haven't received the required 8 hours of rest"
    },
    same_mission_recent_penalty: {
      label: "Same Mission Repeat Penalty",
      description: "Higher values prevent the algorithm from assigning the same soldier to the same mission in recent periods"
    },
    mission_repeat_count_penalty: {
      label: "Mission Repeat Count Penalty",
      description: "Higher values add more penalty for each time the soldier has repeated the same mission"
    },
    today_assignment_count_penalty: {
      label: "Today's Assignment Count Penalty",
      description: "Higher values penalize soldiers who already have many assignments today"
    },
    total_hours_window_penalty_per_hour: {
      label: "Total Hours Window Penalty (per hour)",
      description: "Higher values penalize soldiers who work many hours during the tracking window"
    },
    recent_gap_boost_per_hour: {
      label: "Extra Rest Bonus (per hour)",
      description: "Negative value - lower (more negative) values give greater advantage to soldiers with longer rest periods"
    },
    slot_repeat_count_penalty: {
      label: "Time Slot Repeat Penalty (morning/evening/night)",
      description: "Higher values prevent the algorithm from assigning the same soldier to the same time of day (morning, evening, night)"
    },
    coassignment_repeat_penalty: {
      label: "Co-assignment Repeat Penalty",
      description: "Higher values prevent the algorithm from assigning the same soldier to work with the same people"
    },
    rest_before_priority_per_hour: {
      label: "Rest Before Priority (per hour)",
      description: "Negative value - lower values give greater advantage to soldiers who rested a lot before the mission"
    },
    rest_after_priority_per_hour: {
      label: "Rest After Priority (per hour)",
      description: "Negative value - lower values prevent the algorithm from creating a short rest period after the mission"
    },
  };

  if (isLoading) {
    return (
      <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "24px", fontSize: "28px", fontWeight: 600 }}>Fairness Weights Settings</h1>
      <p style={{ marginBottom: "24px", color: "#9ca3af", fontSize: "14px" }}>
        Adjust the weights that influence the planning algorithm. Higher values = greater penalty. 
        Negative values = reward (advantage). Changes are saved automatically and will affect the next plan.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginBottom: "24px" }}>
        {(Object.keys(weightDescriptions) as Array<keyof PlannerWeights>).map((key) => {
          const { label, description } = weightDescriptions[key];
          const value = weights[key];
          return (
            <div
              key={key}
              style={{
                padding: "16px",
                backgroundColor: "#1f2937",
                borderRadius: "8px",
                border: "1px solid #374151",
              }}
            >
              <div style={{ marginBottom: "8px" }}>
                <label
                  htmlFor={key}
                  style={{
                    display: "block",
                    fontSize: "16px",
                    fontWeight: 600,
                    marginBottom: "4px",
                  }}
                >
                  {label}
                </label>
                <p style={{ fontSize: "12px", color: "#9ca3af", margin: 0 }}>
                  {description}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "12px" }}>
                <input
                  type="range"
                  id={key}
                  min={-5}
                  max={10}
                  step={0.1}
                  value={value}
                  onChange={(e) => handleWeightChange(key, parseFloat(e.target.value))}
                  style={{
                    flex: 1,
                    height: "6px",
                    borderRadius: "3px",
                    outline: "none",
                    backgroundColor: "#374151",
                  }}
                />
                <input
                  type="number"
                  value={value}
                  onChange={(e) => handleWeightChange(key, parseFloat(e.target.value) || 0)}
                  min={-5}
                  max={10}
                  step={0.1}
                  style={{
                    width: "100px",
                    padding: "6px 8px",
                    backgroundColor: "#111827",
                    border: "1px solid #374151",
                    borderRadius: "4px",
                    color: "var(--fg)",
                    fontSize: "14px",
                    textAlign: "left",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
        <button
          onClick={handleReset}
          style={{
            padding: "10px 20px",
            backgroundColor: "#374151",
            border: "none",
            borderRadius: "6px",
            color: "var(--fg)",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: 500,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#4b5563")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#374151")}
        >
          Reset to Defaults
        </button>
      </div>

      {saveStatus === "success" && (
        <div
          style={{
            marginTop: "16px",
            padding: "12px",
            backgroundColor: "#10b981",
            borderRadius: "6px",
            color: "white",
            fontSize: "14px",
          }}
        >
          Settings saved successfully! Changes will apply to the next plan.
        </div>
      )}
    </div>
  );
}

