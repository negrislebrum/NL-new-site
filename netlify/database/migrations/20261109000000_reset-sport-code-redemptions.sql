-- Fresh start for the relaunched SPORT code: its use count goes back to 0 and any old holds are cleared.
DELETE FROM coupon_redemptions WHERE code = 'SPORT';
