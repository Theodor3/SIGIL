import { clamp, scriptedPolicy } from "./scripted-policy.js";

const DEFAULT_ACTION = Object.freeze({
  move_x: 0,
  move_y: 0,
  aim_x: 1,
  aim_y: 0,
  shoot: 0,
  dash: 0,
});

function applyBounds(action, bounds = {}) {
  const min = bounds.min ?? {};
  const max = bounds.max ?? {};
  return {
    move_x: clamp(action.move_x ?? 0, min.move_x ?? -1, max.move_x ?? 1),
    move_y: clamp(action.move_y ?? 0, min.move_y ?? -1, max.move_y ?? 1),
    aim_x: clamp(action.aim_x ?? 1, min.aim_x ?? -1, max.aim_x ?? 1),
    aim_y: clamp(action.aim_y ?? 0, min.aim_y ?? -1, max.aim_y ?? 1),
    shoot: action.shoot ? 1 : 0,
    dash: action.dash ? 1 : 0,
  };
}

function normalizeObservation(observation, metadata) {
  const order = metadata.feature_order || [];
  const stats = metadata.normalization || {};
  return order.map((name) => {
    const value = observation.flat[name] ?? 0;
    const mean = stats[name]?.mean ?? 0;
    const std = stats[name]?.std ?? 1;
    return (value - mean) / (std || 1);
  });
}

function denormalizeAction(vector, metadata) {
  const order = metadata.action_order || ["move_x", "move_y", "aim_x", "aim_y", "shoot", "dash"];
  const out = { ...DEFAULT_ACTION };
  for (let i = 0; i < order.length; i += 1) {
    out[order[i]] = Number.isFinite(vector[i]) ? vector[i] : 0;
  }
  out.shoot = out.shoot > 0 ? 1 : 0;
  out.dash = out.dash > 0 ? 1 : 0;
  return out;
}

function linearForward(input, weights) {
  const hidden = weights.w1.map((row, i) => {
    let sum = weights.b1[i] ?? 0;
    for (let j = 0; j < row.length; j += 1) {
      sum += row[j] * input[j];
    }
    return Math.tanh(sum);
  });

  return weights.w2.map((row, i) => {
    let sum = weights.b2[i] ?? 0;
    for (let j = 0; j < row.length; j += 1) {
      sum += row[j] * hidden[j];
    }
    return Math.tanh(sum);
  });
}

export async function loadPolicy(modelUrl, metadataUrl) {
  const metadataResponse = await fetch(metadataUrl);
  if (!metadataResponse.ok) {
    throw new Error(`Failed metadata load: ${metadataUrl}`);
  }
  const metadata = await metadataResponse.json();

  const role = metadata.supported_mode || "opponent";
  let weights = null;
  let tfModel = null;
  let backend = "scripted";

  if (modelUrl) {
    try {
      const modelResponse = await fetch(modelUrl);
      if (modelResponse.ok) {
        const body = await modelResponse.json();
        if (body.format === "linear-mlp") {
          weights = body.weights;
          backend = "linear-mlp";
        }
      }
    } catch (_err) {
      // Fall through to TensorFlow.js attempt and finally scripted fallback.
    }

    if (!weights && globalThis.tf?.loadLayersModel) {
      try {
        tfModel = await globalThis.tf.loadLayersModel(modelUrl);
        backend = "tfjs";
      } catch (_err) {
        tfModel = null;
      }
    }
  }

  return {
    backend,
    metadata,
    role,
    inferAction(observation) {
      if (!observation) return DEFAULT_ACTION;

      if (backend === "linear-mlp" && weights) {
        const input = normalizeObservation(observation, metadata);
        const output = linearForward(input, weights);
        return applyBounds(denormalizeAction(output, metadata), metadata.action_bounds);
      }

      if (backend === "tfjs" && tfModel) {
        const input = normalizeObservation(observation, metadata);
        const tensor = globalThis.tf.tensor2d([input]);
        const result = tfModel.predict(tensor);
        const output = Array.from(result.dataSync());
        tensor.dispose();
        result.dispose();
        return applyBounds(denormalizeAction(output, metadata), metadata.action_bounds);
      }

      return applyBounds(scriptedPolicy(observation, role), metadata.action_bounds);
    },
  };
}
