import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy, DetachedRouteHandle } from '@angular/router';

/**
 * Reuses the component instance for routes marked with `data: { reuse: true }`,
 * preserving all component state (form values, scroll position, running timers)
 * across navigation. Opt-in per route.
 */
@Injectable()
export class ReusableRouteStrategy extends BaseRouteReuseStrategy {
  private handles = new Map<string, DetachedRouteHandle>();

  override shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return this.isReusable(route);
  }

  override store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    const key = this.keyFor(route);
    if (!key) return;
    if (this.isReusable(route) && handle) {
      this.handles.set(key, handle);
    } else {
      this.handles.delete(key);
    }
  }

  override shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const key = this.keyFor(route);
    return !!key && this.isReusable(route) && this.handles.has(key);
  }

  override retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const key = this.keyFor(route);
    if (!key || !this.isReusable(route)) return null;
    return this.handles.get(key) ?? null;
  }

  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return future.routeConfig === curr.routeConfig;
  }

  private isReusable(route: ActivatedRouteSnapshot): boolean {
    return route.data?.['reuse'] === true;
  }

  private keyFor(route: ActivatedRouteSnapshot): string | null {
    return route.routeConfig?.path ?? null;
  }
}
