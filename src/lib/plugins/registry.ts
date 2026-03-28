import type { ICodingAgent, IVerifier, IVLMProvider } from './interfaces';

class PluginRegistry {
  private agents = new Map<string, ICodingAgent>();
  private verifiers = new Map<string, IVerifier>();
  private vlmProviders = new Map<string, IVLMProvider>();

  private static _instance: PluginRegistry;
  static get instance(): PluginRegistry {
    if (!this._instance) this._instance = new PluginRegistry();
    return this._instance;
  }

  registerAgent(agent: ICodingAgent): void {
    this.agents.set(agent.id, agent);
  }

  registerVerifier(verifier: IVerifier): void {
    this.verifiers.set(verifier.id, verifier);
  }

  registerVLMProvider(provider: IVLMProvider): void {
    this.vlmProviders.set(provider.id, provider);
  }

  getAgent(id: string): ICodingAgent | undefined {
    return this.agents.get(id);
  }

  getVerifier(type: string): IVerifier | undefined {
    for (const v of this.verifiers.values()) {
      if (v.type === type) return v;
    }
    return undefined;
  }

  getVLMProvider(id?: string): IVLMProvider | undefined {
    if (id) return this.vlmProviders.get(id);
    return this.vlmProviders.values().next().value;
  }

  listAgents(): ICodingAgent[] { return [...this.agents.values()]; }
  listVerifiers(): IVerifier[] { return [...this.verifiers.values()]; }
  listVLMProviders(): IVLMProvider[] { return [...this.vlmProviders.values()]; }
}

export { PluginRegistry };
