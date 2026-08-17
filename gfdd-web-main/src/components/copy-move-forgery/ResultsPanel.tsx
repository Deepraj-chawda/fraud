import React from "react";
import { cn } from "@/lib/utils";

interface ResultsPanelProps {
  results: {
    keypoints: number;
    filtered: number;
    matches: number;
    clusters: number;
    regions: number;
  };
  className?: string;
}

const ResultsPanel: React.FC<ResultsPanelProps> = ({ results, className }) => {
  // Determine if forgery was detected
  const forgeryDetected = results.clusters > 0 || results.regions > 0;

  // Create metrics array for easy mapping
  const metrics = [
    { label: "Keypoints", value: results.keypoints },
    { label: "Filtered", value: results.filtered },
    { label: "Matches", value: results.matches },
    { label: "Clusters", value: results.clusters, highlight: results.clusters > 0 },
    { label: "Regions", value: results.regions, highlight: results.regions > 0 },
  ];

  return (
    <div className={cn("", className)}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-slate-700">Detection Results</h3>
        {/* <div
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium",
            forgeryDetected
              ? "bg-red-100 text-red-800"
              : "bg-green-100 text-green-800"
          )}
        >
          {forgeryDetected ? "Forgery Detected" : "No Forgery Detected"}
        </div> */}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="text-center">
            <div 
              className={cn(
                "text-2xl font-mono font-bold mb-1",
                metric.highlight ? "text-red-600" : "text-slate-900"
              )}
            >
              {metric.value}
            </div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">
              {metric.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ResultsPanel;
