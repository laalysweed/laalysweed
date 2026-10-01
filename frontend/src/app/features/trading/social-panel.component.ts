import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AccountService } from '../../core/account.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { SoundService } from '../../core/ui.service';
import { ApiError, TraderStats } from '../../core/models';
import { money, signedMoney } from '../../core/format';

export interface SocialTrader {
  id: string;
  profileId: number;
  name: string;
  prefix: string;
  avatarType: 'dollar' | 'suit' | 'rainbow' | 'photo' | 'init';
  avatarBg?: string;
  flag?: string;
  trades: number;
  winRate: number;
  profitPct: number;
  status: 'online' | 'offline';
  followers: number;
  watchers: number;
  profileLevel: 'Beginner' | 'Pro' | 'Master' | 'Legend';
  accountLevel: 'Silver' | 'Gold' | 'Platinum' | 'Diamond';
  turnover: number;
  profitAmount: number;
  maxProfit: number;
  minProfit: number;
  shifting?: boolean;
}

const SEED_TRADERS: Omit<SocialTrader, 'id'>[] = [
  { profileId: 3348, prefix: 'LR', name: 'Rakhymgali A.', avatarType: 'dollar', trades: 29, winRate: 71.0, profitPct: 6521.0, status: 'online', followers: 142, watchers: 89, profileLevel: 'Master', accountLevel: 'Gold', turnover: 48500, profitAmount: 12400, maxProfit: 1850, minProfit: -120 },
  { profileId: 4892, prefix: 'CM', name: 'Svetlana G', avatarType: 'suit', trades: 33, winRate: 78.0, profitPct: 6215.0, status: 'online', followers: 230, watchers: 145, profileLevel: 'Legend', accountLevel: 'Platinum', turnover: 72000, profitAmount: 18600, maxProfit: 2400, minProfit: -90 },
  { profileId: 5120, prefix: '', flag: '🇿🇦', name: 'Nokubonga N.', avatarType: 'rainbow', trades: 46, winRate: 65.0, profitPct: 5413.0, status: 'online', followers: 98, watchers: 64, profileLevel: 'Pro', accountLevel: 'Silver', turnover: 31000, profitAmount: 8900, maxProfit: 1100, minProfit: -210 },
  { profileId: 2841, prefix: 'JM', name: 'Batyr C.', avatarType: 'suit', trades: 60, winRate: 72.0, profitPct: 5413.0, status: 'online', followers: 315, watchers: 198, profileLevel: 'Master', accountLevel: 'Platinum', turnover: 95000, profitAmount: 24500, maxProfit: 3200, minProfit: -150 },
  { profileId: 6739, prefix: 'MA', name: 'Walther Fabian S.', avatarType: 'photo', avatarBg: '#0284c7', trades: 51, winRate: 69.0, profitPct: 5411.0, status: 'online', followers: 167, watchers: 92, profileLevel: 'Pro', accountLevel: 'Gold', turnover: 58000, profitAmount: 14200, maxProfit: 1950, minProfit: -180 },
  { profileId: 8190, prefix: 'RK', name: 'Chen Wei', avatarType: 'dollar', trades: 42, winRate: 76.5, profitPct: 5180.0, status: 'online', followers: 280, watchers: 170, profileLevel: 'Legend', accountLevel: 'Diamond', turnover: 112000, profitAmount: 31000, maxProfit: 4100, minProfit: -80 },
  { profileId: 3914, prefix: 'DA', name: 'David Alaba', avatarType: 'photo', avatarBg: '#10b981', trades: 38, winRate: 74.0, profitPct: 4950.0, status: 'online', followers: 110, watchers: 75, profileLevel: 'Master', accountLevel: 'Gold', turnover: 44000, profitAmount: 11200, maxProfit: 1600, minProfit: -110 },
  { profileId: 7421, prefix: 'FL', name: 'Fatima Zahra', avatarType: 'init', avatarBg: '#8b5cf6', trades: 57, winRate: 70.0, profitPct: 4820.0, status: 'online', followers: 195, watchers: 120, profileLevel: 'Pro', accountLevel: 'Silver', turnover: 39000, profitAmount: 9800, maxProfit: 1350, minProfit: -140 },
  { profileId: 9205, prefix: 'MS', name: 'Mateo Silva', avatarType: 'suit', trades: 28, winRate: 82.0, profitPct: 4690.0, status: 'online', followers: 204, watchers: 135, profileLevel: 'Master', accountLevel: 'Platinum', turnover: 67000, profitAmount: 17400, maxProfit: 2800, minProfit: -60 },
  { profileId: 1843, prefix: 'SK', name: 'Sanjay Kumar', avatarType: 'init', avatarBg: '#f97316', trades: 64, winRate: 68.0, profitPct: 4520.0, status: 'online', followers: 140, watchers: 88, profileLevel: 'Pro', accountLevel: 'Gold', turnover: 51000, profitAmount: 12800, maxProfit: 1700, minProfit: -220 },
  { profileId: 6291, prefix: 'EK', name: 'Elena Rostova', avatarType: 'photo', avatarBg: '#ec4899', trades: 39, winRate: 75.0, profitPct: 4410.0, status: 'online', followers: 220, watchers: 150, profileLevel: 'Master', accountLevel: 'Platinum', turnover: 78000, profitAmount: 19500, maxProfit: 2600, minProfit: -95 },
  { profileId: 4419, prefix: 'YB', name: 'Youssef B.', avatarType: 'dollar', trades: 49, winRate: 71.5, profitPct: 4320.0, status: 'online', followers: 125, watchers: 78, profileLevel: 'Pro', accountLevel: 'Silver', turnover: 36000, profitAmount: 9200, maxProfit: 1250, minProfit: -130 },
  { profileId: 5882, prefix: 'HS', name: 'Henrik S.', avatarType: 'suit', trades: 53, winRate: 73.0, profitPct: 4210.0, status: 'online', followers: 180, watchers: 110, profileLevel: 'Master', accountLevel: 'Gold', turnover: 61000, profitAmount: 15300, maxProfit: 2100, minProfit: -115 },
  { profileId: 3012, prefix: 'OB', name: 'Olawale B.', avatarType: 'init', avatarBg: '#14b8a6', trades: 44, winRate: 69.5, profitPct: 4090.0, status: 'online', followers: 95, watchers: 60, profileLevel: 'Pro', accountLevel: 'Silver', turnover: 29000, profitAmount: 7600, maxProfit: 980, minProfit: -160 },
  { profileId: 8831, prefix: 'TL', name: 'Tenzin L.', avatarType: 'photo', avatarBg: '#6366f1', trades: 36, winRate: 77.0, profitPct: 3980.0, status: 'online', followers: 150, watchers: 95, profileLevel: 'Master', accountLevel: 'Gold', turnover: 49000, profitAmount: 13100, maxProfit: 1800, minProfit: -70 },
  { profileId: 2194, prefix: 'NP', name: 'Nguyen P.', avatarType: 'rainbow', trades: 58, winRate: 67.0, profitPct: 3860.0, status: 'online', followers: 115, watchers: 70, profileLevel: 'Pro', accountLevel: 'Silver', turnover: 33000, profitAmount: 8400, maxProfit: 1150, minProfit: -190 },
];

const NAMES_POOL = [
  'Lucas M.', 'Kento Y.', 'Pavel D.', 'Amara K.', 'Gabriel C.', 'Sofia R.', 'Ibrahim M.', 'Lars N.', 'Chidi O.',
  'Mateo F.', 'Zubair A.', 'Dmitry K.', 'Valerie T.', 'Santiago P.', 'Kenji S.', 'Fatou D.', 'Bogdan V.', 'Maya E.'
];

@Component({
  selector: 'app-social-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RouterLink],
  template: `
    <!-- ============ TOPBAR / HEADER (IMAGE 4) ============ -->
    <div class="social-header">
      <h3 class="title">Social Trading</h3>

      <!-- TIMEFRAME DROPDOWN PILL -->
      <div class="timeframe-pill">
        <button class="pill-btn" (click)="tfOpen.set(!tfOpen())">
          <span class="left"><app-icon name="clock" [size]="16" /> {{ selectedTf() }}</span>
          <app-icon name="chevron-down" [size]="14" [class.flip]="tfOpen()" />
        </button>

        @if (tfOpen()) {
          <div class="timeframe-backdrop" (click)="tfOpen.set(false)"></div>
          <div class="timeframe-dropdown anim-pop">
            @for (tf of timeframes; track tf) {
              <button [class.active]="selectedTf() === tf" (click)="pickTf(tf)">
                <span>{{ tf }}</span>
                @if (selectedTf() === tf) { <app-icon name="check" [size]="14" /> }
              </button>
            }
          </div>
        }
      </div>
    </div>

    <!-- CATEGORY LABEL -->
    <div class="category-label">REAL TRADING</div>

    <!-- TRADER LIST (IMAGE 4) WITH UNLIMITED SHIFTING NAMES -->
    <div class="trader-list" (scroll)="onScroll($event)">
      @for (t of traders(); track t.id) {
        <button class="trader-card" [class.shifting]="t.shifting" (click)="openProfile(t)">
          <!-- AVATAR WITH GOLD STAR BADGE -->
          <div class="ava-wrap">
            <span class="star-badge">★</span>
            @switch (t.avatarType) {
              @case ('dollar') {
                <div class="avatar gold-dollar"><span>$</span></div>
              }
              @case ('rainbow') {
                <div class="avatar rainbow-flag"></div>
              }
              @case ('suit') {
                <div class="avatar suit-man">
                  <svg viewBox="0 0 36 36" fill="currentColor" width="28" height="28">
                    <circle cx="18" cy="11" r="6" fill="#cbd5e1"/>
                    <path d="M7 32c0-6 5-11 11-11s11 5 11 11H7z" fill="#94a3b8"/>
                    <polygon points="18 21 16 32 20 32" fill="#0f172a"/>
                  </svg>
                </div>
              }
              @default {
                <div class="avatar" [style.background]="t.avatarBg || '#1e293b'">
                  <span>{{ t.prefix || t.name[0] }}</span>
                </div>
              }
            }
          </div>

          <!-- TRADER INFO -->
          <div class="info">
            <div class="name-row">
              @if (t.flag) { <span class="flag">{{ t.flag }}</span> }
              @if (t.prefix) { <span>{{ t.prefix }}</span> }
              <b>{{ t.name }}</b>
            </div>
            <div class="stat-line">
              Trades: <span>{{ t.trades }}</span>
            </div>
            <div class="stat-line">
              Win rate: <span>{{ t.winRate.toFixed(1) }}%</span>
            </div>
          </div>

          <!-- PROFIT PERCENTAGE -->
          <div class="profit">
            +{{ t.profitPct.toFixed(1) }}%
          </div>
        </button>
      }
    </div>

    <!-- ============ TRADER PROFILE MODAL (IMAGE 5) ============ -->
    @if (profile(); as p) {
      <div class="modal-backdrop anim-fade" (click)="profile.set(null)"></div>
      <div class="profile-modal anim-pop" role="dialog" aria-modal="true">
        <!-- MODAL HEADER -->
        <header class="pm-header">
          <h4>Real trading profile ID: {{ p.profileId }}</h4>
          <button class="close-btn" (click)="profile.set(null)" aria-label="Close">
            <app-icon name="close" [size]="16" />
          </button>
        </header>

        <!-- PROFILE CARD (MATCHING IMAGE 5) -->
        <div class="pm-summary">
          <!-- BIG PURPLE GLOBE WITH GOLD RIM & STAR -->
          <div class="globe-ava-wrap">
            <div class="globe-rim">
              <span class="globe-star">★</span>
              <div class="globe-circle">
                <!-- SVG Vector of Earth Globe -->
                <svg viewBox="0 0 100 100" class="globe-svg">
                  <circle cx="50" cy="50" r="48" fill="#38bdf8" />
                  <!-- Green continents -->
                  <path d="M30 20c4 5 10 2 12 8s-2 10 5 12 15-5 18 2 0 12-8 14-10-4-15 0-8 12-14 8-6-10-2-16 2-12 4-28z" fill="#4ade80" />
                  <path d="M60 40c6 2 12 8 16 6s8-6 10 2-4 12-10 14-12-2-14-8-2-10-2-14z" fill="#4ade80" />
                  <path d="M45 70c5 2 10 8 14 6s6-8 4-12-8-4-12 0-8 4-6 6z" fill="#4ade80" />
                </svg>
              </div>
            </div>
          </div>

          <!-- DETAILS GRID -->
          <div class="pm-meta-grid">
            <div class="cell">
              <span class="lbl">Name</span>
              <b class="val">{{ p.name.toLowerCase() }}</b>
            </div>
            <div class="cell">
              <span class="lbl">Status</span>
              <b class="val status-online">online <span class="dot">●</span></b>
            </div>
            <div class="cell">
              <span class="lbl">Followers</span>
              <b class="val">{{ p.followers }}</b>
            </div>
            <div class="cell">
              <span class="lbl">Profile Level</span>
              <b class="val">{{ p.profileLevel }}</b>
            </div>
            <div class="cell">
              <span class="lbl">Account Level</span>
              <b class="val"><app-icon name="medal" [size]="15" /> {{ p.accountLevel }}</b>
            </div>
            <div class="cell">
              <span class="lbl">Watchers</span>
              <b class="val">{{ p.watchers }}</b>
            </div>
          </div>
        </div>

        <!-- NOTICE BANNER -->
        <div class="pm-notice">
          <span class="ico">ⓘ</span>
          <span><a routerLink="/app/finance/deposit" (click)="profile.set(null)" class="link-bold">Add money</a> to your account in order to copy trades.</span>
        </div>

        <!-- BIG ACTION BUTTONS: [ WATCH ] & [ COPY ] -->
        <div class="pm-actions">
          <button class="btn-watch" [class.watching]="isWatching(p.id)" (click)="toggleWatch(p.id)">
            {{ isWatching(p.id) ? 'Watching' : 'Watch' }}
          </button>
          <button class="btn-copy" (click)="copyOpen.set(!copyOpen())">
            Copy
          </button>
        </div>

        <!-- COPY SETTINGS EXPANSION (IF CLICKED) -->
        @if (copyOpen()) {
          <div class="copy-settings anim-rise">
            <div class="cs-row">
              <label>Copy amount (USD):</label>
              <input type="number" min="1" max="1000" [ngModel]="copyAmount()" (ngModelChange)="copyAmount.set($event)" class="cs-input" />
            </div>
            <button class="btn-start-copy" (click)="startCopy(p)">Confirm Copy Trade</button>
          </div>
        }

        <!-- TABBED STATISTICS SECTION -->
        <div class="pm-tabs-section">
          <!-- LEFT VERTICAL TABS -->
          <div class="pm-tabs">
            <button [class.active]="activeTab() === 'trading'" (click)="activeTab.set('trading')">
              Trading Statistics
            </button>
            <button [class.active]="activeTab() === 'social'" (click)="activeTab.set('social')">
              Social Statistics
            </button>
            <button [class.active]="activeTab() === 'achievements'" (click)="activeTab.set('achievements')">
              Achievements
            </button>
          </div>

          <!-- RIGHT TAB CONTENT -->
          <div class="pm-tab-content">
            @switch (activeTab()) {
              @case ('trading') {
                <div class="sub-filter">
                  <app-icon name="clock" [size]="14" /> Total Trades
                </div>

                <div class="stat-rows">
                  <div class="stat-row">
                    <span class="sr-lbl">Trades:</span>
                    <b class="sr-val">{{ p.trades }}</b>
                  </div>
                  <div class="stat-row">
                    <span class="sr-lbl">Profitable trades:</span>
                    <b class="sr-val">{{ p.winRate.toFixed(1) }}%</b>
                  </div>
                  <div class="stat-row">
                    <span class="sr-lbl">Trading turnover:</span>
                    <b class="sr-val">\${{ p.turnover.toLocaleString() }}</b>
                  </div>
                  <div class="stat-row">
                    <span class="sr-lbl">Trading profit:</span>
                    <b class="sr-val up-text">+\${{ p.profitAmount.toLocaleString() }}</b>
                  </div>
                  <div class="stat-row">
                    <span class="sr-lbl">Max profit trade:</span>
                    <b class="sr-val up-text">+\${{ p.maxProfit.toLocaleString() }}</b>
                  </div>
                  <div class="stat-row">
                    <span class="sr-lbl">Min profit trade:</span>
                    <b class="sr-val down-text">\${{ p.minProfit }}</b>
                  </div>
                </div>
              }

              @case ('social') {
                <div class="stat-rows">
                  <div class="stat-row">
                    <span class="sr-lbl">Current copiers:</span>
                    <b class="sr-val">{{ p.followers }}</b>
                  </div>
                  <div class="stat-row">
                    <span class="sr-lbl">Watchlist count:</span>
                    <b class="sr-val">{{ p.watchers }}</b>
                  </div>
                  <div class="stat-row">
                    <span class="sr-lbl">Platform Rank:</span>
                    <b class="sr-val up-text">#{{ p.profileId % 50 + 1 }} Global</b>
                  </div>
                  <div class="stat-row">
                    <span class="sr-lbl">Shared P/L:</span>
                    <b class="sr-val up-text">+\${{ (p.profitAmount * 2.4).toLocaleString() }}</b>
                  </div>
                </div>
              }

              @case ('achievements') {
                <div class="badges-grid">
                  <div class="badge-item"><span>🏆</span><b>Top 100 Trader</b><small>High ROI ranking</small></div>
                  <div class="badge-item"><span>⚡</span><b>Fast Execution</b><small>Average 45ms</small></div>
                  <div class="badge-item"><span>🛡️</span><b>Risk Manager</b><small>Max DD &lt; 12%</small></div>
                  <div class="badge-item"><span>💎</span><b>Diamond Hands</b><small>Consistent monthly profit</small></div>
                </div>
              }
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: #111726;
        color: #fff;
        overflow: hidden;
        position: relative;
        font-family: inherit;
      }

      .social-header {
        padding: 16px 14px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        flex-shrink: 0;

        .title {
          font-size: 18px;
          font-weight: 700;
          text-align: center;
          color: #fff;
          margin: 0 0 12px;
          letter-spacing: -0.01em;
        }

        .timeframe-pill {
          position: relative;
          width: 100%;

          .pill-btn {
            width: 100%;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 14px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.08);
            color: #cbd5e1;
            font-size: 13.5px;
            font-weight: 500;
            cursor: pointer;
            transition: all 180ms ease;

            &:hover {
              background: rgba(255, 255, 255, 0.08);
              border-color: rgba(255, 255, 255, 0.15);
            }

            .left {
              display: flex;
              align-items: center;
              gap: 8px;
              app-icon { color: #94a3b8; }
            }

            app-icon.flip {
              transform: rotate(180deg);
            }
          }

          .timeframe-backdrop {
            position: fixed;
            inset: 0;
            z-index: 49;
          }

          .timeframe-dropdown {
            position: absolute;
            top: calc(100% + 6px);
            left: 0;
            right: 0;
            z-index: 50;
            background: #162032;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 12px;
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6);
            overflow: hidden;

            button {
              width: 100%;
              padding: 10px 14px;
              text-align: left;
              background: none;
              border: 0;
              color: #cbd5e1;
              font-size: 13px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              cursor: pointer;
              transition: background 150ms ease;

              &:hover, &.active {
                background: rgba(56, 189, 248, 0.12);
                color: #38bdf8;
              }
            }
          }
        }
      }

      .category-label {
        padding: 12px 16px 6px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #64748b;
        text-transform: uppercase;
      }

      .trader-list {
        flex: 1;
        overflow-y: auto;
        padding: 0 8px 16px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .trader-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 9px 10px;
        border-radius: 10px;
        background: transparent;
        border: 1px solid transparent;
        cursor: pointer;
        text-align: left;
        width: 100%;
        transition: all 250ms ease;

        &:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(255, 255, 255, 0.08);
        }

        &.shifting {
          background: rgba(34, 197, 94, 0.14) !important;
          border-color: rgba(34, 197, 94, 0.35) !important;
          transform: translateX(2px);
        }
      }

      .ava-wrap {
        position: relative;
        width: 44px;
        height: 44px;
        flex-shrink: 0;

        .star-badge {
          position: absolute;
          top: -2px;
          left: -2px;
          width: 17px;
          height: 17px;
          border-radius: 50%;
          background: #0b111e;
          color: #f59e0b;
          display: grid;
          place-items: center;
          border: 1.5px solid #f59e0b;
          font-size: 9px;
          font-weight: 900;
          z-index: 2;
        }

        .avatar {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          overflow: hidden;
          display: grid;
          place-items: center;
          font-weight: 700;
          font-size: 15px;
          background: #1e293b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #fff;

          &.gold-dollar {
            background: radial-gradient(circle at 35% 35%, #ffd700 0%, #b8860b 80%, #8b6508 100%);
            color: #3e2704;
            font-size: 22px;
            font-weight: 900;
            text-shadow: 0 1px 1px rgba(255, 255, 255, 0.5);
          }

          &.rainbow-flag {
            background: linear-gradient(180deg, #e40303 0%, #ff8c00 20%, #ffed00 40%, #008026 60%, #004dff 80%, #750787 100%);
          }

          &.suit-man {
            background: linear-gradient(135deg, #334155, #1e293b);
            color: #38bdf8;
          }
        }
      }

      .info {
        flex: 1;
        min-width: 0;

        .name-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
          font-weight: 700;
          color: #ffffff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;

          .flag { font-size: 13px; }
        }

        .stat-line {
          font-size: 11.5px;
          color: #94a3b8;
          line-height: 1.35;
          margin-top: 1px;

          span { color: #cbd5e1; }
        }
      }

      .profit {
        text-align: right;
        font-size: 15px;
        font-weight: 700;
        color: #22c55e;
        letter-spacing: -0.01em;
        white-space: nowrap;
      }

      /* ================= MODAL IMAGE 5 ================= */
      .modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 120;
        background: rgba(3, 7, 18, 0.75);
        backdrop-filter: blur(6px);
      }

      .profile-modal {
        position: fixed;
        z-index: 121;
        top: 50%;
        left: 50%;
        width: min(680px, calc(100vw - 28px));
        max-height: 90vh;
        overflow-y: auto;
        transform: translate(-50%, -50%);
        padding: 24px 28px 28px;
        border-radius: 16px;
        background: #151d2e;
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.8);
      }

      .pm-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;

        h4 {
          font-size: 17px;
          font-weight: 700;
          color: #fff;
          margin: 0;
        }

        .close-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.05);
          color: #94a3b8;
          display: grid;
          place-items: center;
          cursor: pointer;
          transition: all 180ms ease;

          &:hover {
            background: rgba(255, 255, 255, 0.12);
            color: #fff;
          }
        }
      }

      .pm-summary {
        display: flex;
        align-items: center;
        gap: 24px;
        margin-bottom: 20px;

        @media (max-width: 600px) {
          flex-direction: column;
          align-items: flex-start;
          gap: 16px;
        }
      }

      .globe-ava-wrap {
        position: relative;
        flex-shrink: 0;

        .globe-rim {
          position: relative;
          width: 104px;
          height: 104px;
          border-radius: 50%;
          border: 3px solid #f59e0b;
          background: #8b5cf6;
          display: grid;
          place-items: center;
          box-shadow: 0 0 20px rgba(245, 158, 11, 0.35);

          .globe-star {
            position: absolute;
            top: 2px;
            right: 2px;
            color: #f59e0b;
            font-size: 15px;
            z-index: 3;
            text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
          }

          .globe-circle {
            width: 72px;
            height: 72px;
            border-radius: 50%;
            overflow: hidden;
            display: grid;
            place-items: center;

            .globe-svg {
              width: 100%;
              height: 100%;
            }
          }
        }
      }

      .pm-meta-grid {
        flex: 1;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px 20px;

        @media (max-width: 480px) {
          grid-template-columns: repeat(2, 1fr);
        }

        .cell {
          display: flex;
          flex-direction: column;
          gap: 4px;

          .lbl {
            font-size: 12.5px;
            color: #94a3b8;
          }

          .val {
            font-size: 15px;
            font-weight: 700;
            color: #ffffff;
            display: flex;
            align-items: center;
            gap: 6px;

            &.status-online {
              color: #ffffff;
              .dot { color: #22c55e; font-size: 12px; }
            }
          }
        }
      }

      .pm-notice {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border-radius: 10px;
        background: rgba(56, 189, 248, 0.08);
        border: 1px solid rgba(56, 189, 248, 0.2);
        color: #cbd5e1;
        font-size: 13.5px;
        margin-bottom: 20px;

        .ico {
          color: #38bdf8;
          font-size: 17px;
        }

        .link-bold {
          color: #38bdf8;
          text-decoration: underline;
          font-weight: 700;
          cursor: pointer;
        }
      }

      .pm-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        margin-bottom: 22px;

        button {
          height: 46px;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          transition: all 180ms ease;
        }

        .btn-watch {
          background: #113425;
          border: 1px solid #166534;
          color: #4ade80;

          &:hover {
            background: #164630;
          }

          &.watching {
            background: #166534;
            color: #ffffff;
          }
        }

        .btn-copy {
          background: #1e293b;
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #ffffff;

          &:hover {
            background: #28374d;
            border-color: #38bdf8;
          }
        }
      }

      .copy-settings {
        padding: 14px 16px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.08);
        margin-bottom: 20px;

        .cs-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 14px;

          .cs-input {
            width: 100px;
            height: 36px;
            border-radius: 8px;
            background: #162032;
            border: 1px solid rgba(255, 255, 255, 0.12);
            color: #fff;
            padding: 0 10px;
          }
        }

        .btn-start-copy {
          margin-top: 10px;
          width: 100%;
          height: 40px;
          border-radius: 8px;
          background: linear-gradient(90deg, #1ddbb8, #38bdf8);
          color: #081726;
          font-weight: 700;
          border: 0;
          cursor: pointer;
        }
      }

      .pm-tabs-section {
        display: grid;
        grid-template-columns: 180px 1fr;
        gap: 16px;
        background: rgba(15, 23, 42, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 16px;

        @media (max-width: 600px) {
          grid-template-columns: 1fr;
        }

        .pm-tabs {
          display: flex;
          flex-direction: column;
          gap: 6px;

          button {
            padding: 11px 14px;
            border-radius: 8px;
            border: 1px solid transparent;
            background: transparent;
            color: #94a3b8;
            font-size: 13.5px;
            font-weight: 600;
            text-align: left;
            cursor: pointer;
            transition: all 180ms ease;

            &:hover {
              color: #ffffff;
              background: rgba(255, 255, 255, 0.04);
            }

            &.active {
              background: rgba(56, 189, 248, 0.12);
              border-color: rgba(56, 189, 248, 0.3);
              color: #38bdf8;
            }
          }
        }

        .pm-tab-content {
          min-width: 0;

          .sub-filter {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.05);
            font-size: 12px;
            color: #cbd5e1;
            margin-bottom: 12px;
          }

          .stat-rows {
            display: flex;
            flex-direction: column;
            gap: 8px;

            .stat-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 9px 12px;
              border-radius: 8px;
              background: rgba(255, 255, 255, 0.03);
              border-left: 3px solid #38bdf8;
              font-size: 13.5px;

              .sr-lbl { color: #94a3b8; }
              .sr-val { color: #ffffff; font-weight: 600; }
              .up-text { color: #22c55e; }
              .down-text { color: #f87171; }
            }
          }

          .badges-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;

            .badge-item {
              padding: 12px;
              border-radius: 8px;
              background: rgba(255, 255, 255, 0.03);
              display: flex;
              flex-direction: column;
              gap: 2px;

              span { font-size: 20px; }
              b { font-size: 13px; color: #fff; }
              small { font-size: 11px; color: #94a3b8; }
            }
          }
        }
      }
    `,
  ],
})
export class SocialPanelComponent {
  private api = inject(ApiService);
  private accounts = inject(AccountService);
  protected auth = inject(AuthService);
  private toast = inject(ToastService);
  private sound = inject(SoundService);

  readonly timeframes = ['Top ranked traders for 24h', 'Top ranked traders for 7d', 'Top ranked traders for 30d', 'All time top traders'];
  protected selectedTf = signal('Top ranked traders for 24h');
  protected tfOpen = signal(false);

  protected traders = signal<SocialTrader[]>([]);
  protected profile = signal<SocialTrader | null>(null);
  protected activeTab = signal<'trading' | 'social' | 'achievements'>('trading');
  protected watchingIds = signal<Set<string>>(new Set());
  protected copyOpen = signal(false);
  protected copyAmount = signal(25);

  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private poolIndex = 0;

  constructor() {
    this.initTraders();
    this.startShifting();

    inject(DestroyRef).onDestroy(() => {
      if (this.intervalTimer) clearInterval(this.intervalTimer);
    });
  }

  private initTraders() {
    const initial: SocialTrader[] = SEED_TRADERS.map((s, idx) => ({
      ...s,
      id: 'st-' + idx + '-' + s.profileId,
    }));
    this.traders.set(initial);
  }

  /** Live shifting mechanism for unlimited dynamic activity. */
  private startShifting() {
    this.intervalTimer = setInterval(() => {
      this.shiftRandomTrader();
    }, 3200);
  }

  private shiftRandomTrader() {
    const list = [...this.traders()];
    if (!list.length) return;

    // Pick random trader in the top 15
    const idx = Math.floor(Math.random() * Math.min(15, list.length));
    const target = { ...list[idx] };

    // Fluctuate stats
    target.trades += 1;
    const pnlDelta = (Math.random() * 8.5 + 1.2) * (Math.random() > 0.1 ? 1 : -0.5);
    target.profitPct = Math.max(100, Math.round((target.profitPct + pnlDelta) * 10) / 10);
    target.winRate = Math.min(98, Math.max(55, Math.round((target.winRate + (Math.random() * 0.4 - 0.15)) * 10) / 10));
    target.turnover += Math.round(Math.random() * 500 + 100);
    target.profitAmount += Math.round(pnlDelta * 15);
    target.shifting = true;

    list[idx] = target;

    // Soft re-sort by profitPct
    list.sort((a, b) => b.profitPct - a.profitPct);
    this.traders.set(list);

    // Remove shifting highlight after 1s
    setTimeout(() => {
      this.traders.update((curr) =>
        curr.map((t) => (t.id === target.id ? { ...t, shifting: false } : t))
      );
    }, 1100);
  }

  protected pickTf(tf: string) {
    this.selectedTf.set(tf);
    this.tfOpen.set(false);
    this.sound.playClick();
    // Simulate rank shift based on timeframe
    this.traders.update((curr) => {
      const copy = [...curr];
      copy.sort(() => Math.random() - 0.5);
      return copy;
    });
  }

  protected openProfile(t: SocialTrader) {
    this.sound.playClick();
    this.profile.set(t);
    this.activeTab.set('trading');
    this.copyOpen.set(false);
  }

  protected isWatching(id: string) {
    return this.watchingIds().has(id);
  }

  protected toggleWatch(id: string) {
    this.sound.playClick();
    this.watchingIds.update((s) => {
      const next = new Set(s);
      if (next.has(id)) {
        next.delete(id);
        this.toast.info('Removed from watchlist');
      } else {
        next.add(id);
        this.toast.success('Added trader to watchlist');
      }
      return next;
    });
  }

  protected startCopy(p: SocialTrader) {
    this.sound.playClick();
    this.toast.success(`Copying ${p.name} ($${this.copyAmount()} per trade)`);
    this.copyOpen.set(false);
    this.profile.set(null);
  }

  /** Infinite scroll handler: appends more traders dynamically. */
  protected onScroll(ev: Event) {
    const el = ev.target as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) {
      this.appendMoreTraders();
    }
  }

  private appendMoreTraders() {
    const nextBatch: SocialTrader[] = [];
    for (let i = 0; i < 6; i++) {
      const name = NAMES_POOL[(this.poolIndex + i) % NAMES_POOL.length];
      const pId = 1000 + Math.floor(Math.random() * 8999);
      nextBatch.push({
        id: 'st-inf-' + Date.now() + '-' + i,
        profileId: pId,
        prefix: name.split(' ')[0].slice(0, 2).toUpperCase(),
        name,
        avatarType: i % 3 === 0 ? 'suit' : i % 2 === 0 ? 'dollar' : 'init',
        avatarBg: ['#0284c7', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899'][i % 5],
        trades: Math.floor(Math.random() * 45) + 18,
        winRate: Math.round((Math.random() * 18 + 64) * 10) / 10,
        profitPct: Math.round((Math.random() * 1500 + 2500) * 10) / 10,
        status: Math.random() > 0.3 ? 'online' : 'offline',
        followers: Math.floor(Math.random() * 120),
        watchers: Math.floor(Math.random() * 80),
        profileLevel: 'Pro',
        accountLevel: i % 2 === 0 ? 'Gold' : 'Silver',
        turnover: Math.floor(Math.random() * 30000) + 15000,
        profitAmount: Math.floor(Math.random() * 8000) + 3000,
        maxProfit: Math.floor(Math.random() * 1200) + 400,
        minProfit: -(Math.floor(Math.random() * 150) + 40),
      });
    }
    this.poolIndex += 6;
    this.traders.update((curr) => [...curr, ...nextBatch]);
  }
}

