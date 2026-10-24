import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { ShopAppComponent } from '../main.component';
import { provideRouter } from '@angular/router';
import { StorefrontComponent } from './app/storefront/storefront.component';

bootstrapApplication(ShopAppComponent, {
  providers: [provideZonelessChangeDetection(), provideRouter([
    { path: '', component: StorefrontComponent },
    { path: 'admin', loadComponent: () => import('./app/admin/admin.component').then(module => module.AdminComponent) },
    { path: '**', redirectTo: '' }
  ])],
}).catch((error: unknown) => console.error(error));
