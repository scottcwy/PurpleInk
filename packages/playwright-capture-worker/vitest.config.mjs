export default {
  test: {
    include: ["tests/**/*.test.{ts,mjs}"],
    exclude: ["tests/control-plane-client.test.mjs"],
  },
};
