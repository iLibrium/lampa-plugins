export class ProviderBase {
  constructor({ name, log }) {
    this.name = name;
    this.log = log || (() => {});
    this.cancelled = false;
  }

  isApplicable(/* ctx */) {
    return true;
  }

  async run(/* ctx, onUpdate */) {
    throw new Error(`${this.name}: run() not implemented`);
  }

  cancel() {
    this.cancelled = true;
  }

  reset() {
    this.cancelled = false;
  }
}
