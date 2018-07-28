import Vue from 'vue';
import Router from 'vue-router';
import store from '@/store';
import Home from '@/views/Home.vue';
import Market from '@/views/Market.vue';
import OpenOrders from '@/views/OpenOrders.vue';
import Portfolio from '@/views/Portfolio.vue';
import Settings from '@/views/Settings.vue';
import About from '@/views/About.vue';

Vue.use(Router);

const requireAuth = (to, from, next) => {
  if (!store.state.auth.account.name) {
    next({ path: '/login', query: { redirect: to.fullPath } });
  } else {
    next();
  }
};

export default new Router({
  mode: 'history',
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/market/:asset', name: 'market', component: Market },
    {
      path: '/open-orders',
      name: 'open-orders',
      beforeEnter: requireAuth,
      component: OpenOrders
    },
    {
      path: '/portfolio',
      name: 'portfolio',
      beforeEnter: requireAuth,
      component: Portfolio,
    },
    { path: '/settings', name: 'settings', component: Settings },
    { path: '/about', name: 'about', component: About },
  ],
});
