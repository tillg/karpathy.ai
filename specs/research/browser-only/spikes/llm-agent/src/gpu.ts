(window as any).runGpu = async () => {
  const gpu = (navigator as any).gpu; const out: any = { hasNavigatorGpu: !!gpu, secureContext: isSecureContext, ua: navigator.userAgent };
  if (gpu) { try { const a = await gpu.requestAdapter(); out.adapter = !!a; out.adapterInfo = a?.info ? { vendor: a.info.vendor, arch: a.info.architecture } : null; out.shaderF16 = a?.features?.has('shader-f16') ?? null; } catch (e) { out.adapterError = String(e); } }
  out.storageEstimate = await navigator.storage.estimate().then((e) => ({ quotaMB: Math.round((e.quota ?? 0) / 1e6) }));
  return out;
};
