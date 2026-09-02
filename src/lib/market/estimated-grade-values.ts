/** Default-on rollback. Set ESTIMATED_GRADE_VALUES=false to disable the estimator. */
export function estimatedGradeValuesEnabled() {
  return process.env.ESTIMATED_GRADE_VALUES !== "false";
}
